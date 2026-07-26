/* ============================================================
   Ports ≠ Sockets — a live nginx server, in three acts.

   A PORT is the single address a server listens on. A SOCKET is a
   connection — there are many, one per client, and it is the file
   descriptor your code read()/write()s. You drive a real nginx server
   and watch the kernel socket table; the port stays one while the sockets
   multiply. Then you break it the way production does.

     Act I  — Bind & Accept : one port, many sockets · EADDRINUSE · the fd ceiling
     Act II — Outbound      : ephemeral source ports · TIME-WAIT
     Act III— Scale         : SO_REUSEPORT — many listeners, one port
   ============================================================ */
(function () {
  "use strict";

  var HOST = "10.0.0.1";        // the box running nginx
  var UP = "10.0.0.9", UP_PORT = 5432;   // an upstream (Postgres) for Act II
  var NGINX_PID = 812, APP_PID = 930;
  var FD_LIMIT = 12;            // this demo host's ulimit -n (kept small on purpose)
  var CONN_CAP = 8;            // inbound connections before the fd ceiling (fds 4..11)
  var PORT_CAP = 8;            // outbound src ports before the ephemeral range "runs out"

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var rint = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var idSeq = 1;

  /* ---------- small builders shared by the "why it matters" cards ---------- */
  function term(cmd, out) { return '<div class="term"><div class="term-cmd">' + esc("$ " + cmd) + '</div><pre class="term-out">' + esc(out) + "</pre></div>"; }
  function note(html) { return '<div class="ld-fields"><div class="ld-field">' + html + "</div></div>"; }
  function chip(colorVar, label) { return '<span class="tchip lit" style="--tc:var(' + colorVar + ')">' + esc(label) + "</span>"; }

  var peerOf = function (s) { return s.pport === "*" ? "0.0.0.0:*" : s.pip + ":" + s.pport; };
  var countState = function (st) { var n = 0; state.sockets.forEach(function (s) { if (s.state === st) n++; }); return n; };
  var countKind = function (k) { var n = 0; state.sockets.forEach(function (s) { if (s.kind === k) n++; }); return n; };

  /* ============================================================
     THE ACTS
     Each act sets up the initial sockets, lists its action buttons,
     supplies its live status line / counters / default takeaway, and its
     "why it matters" cards. Actions mutate `state` and set `state.flash`
     (a line for the stat area) and `state.spot` (a card to highlight).
     ============================================================ */
  var ACTS = [
    /* ---------------- Act I — Bind & Accept ---------------- */
    {
      num: "I", name: "Bind & Accept",
      dek: "One nginx, one port — so how does it serve every client at once?",
      ss: "ss -tlnp ; ss -tnp",
      init: function () {
        state.sockets = [ mk({ state: "LISTEN", kind: "listen", lip: "0.0.0.0", lport: 80, pip: "0.0.0.0", pport: "*", proc: "nginx", pid: NGINX_PID, fd: 3 }) ];
      },
      actions: function () { return [
        { id: "accept", label: "Accept a client", run: acceptI },
        { id: "close", label: "Close a connection", run: closeI, enabled: countKind("conn") > 0 },
        { id: "second", label: "Start a 2nd nginx", danger: true, run: secondNginx }
      ]; },
      ticket: function () { var n = countKind("conn"); return method("nginx") + '<span class="req-path">listening on :<b>80</b></span><span class="req-body">' + n + " connection" + (n === 1 ? "" : "s") + "</span>"; },
      counters: function () { var n = countKind("conn"); return chip("--c-port", "1 port · :80") + chip("--c-socket", n + " socket" + (n === 1 ? "" : "s")) + chip("--c-tuple", (n + 1) + " open fds"); },
      stat: function () { return { html: "One <b>LISTEN</b> row is the port. Every <b>ESTAB</b> row is a separate connection — same :80, its own fd. That is how a single port serves everyone." }; },
      cards: [
        { key: "socket", name: "The socket is the endpoint", kind: "what you read", color: "--c-socket",
          cap: "<code>accept()</code> hands your code a new <b>fd</b> per client — that fd is the socket, and it's what you <code>read()</code>/<code>write()</code>. The port only named the door.",
          detail: term("ss -tnp state established '( sport = :80 )'",
            'ESTAB 0 0 10.0.0.1:80 10.0.0.55:54321 users:(("nginx",pid=812,fd=4))\n' +
            'ESTAB 0 0 10.0.0.1:80 10.0.0.66:12345 users:(("nginx",pid=812,fd=5))\n' +
            "# same :80 — one socket (fd) per connection") +
            note("Your handler never sees the port as a channel; it holds a socket fd. <code>read(fd)</code> drains that one client's bytes and nobody else's.") },
        { key: "bind", name: "One bind per port", kind: "EADDRINUSE", color: "--c-listen",
          cap: "Only one socket may <code>bind()</code> a given port. A second process on :80 gets <b>EADDRINUSE</b> — nothing to do with how many clients are connected.",
          detail: term("sudo systemctl start nginx@2",
            "nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)") +
            note("<code>SO_REUSEADDR</code> lets you rebind through a lingering TIME-WAIT after a restart; <code>SO_REUSEPORT</code> (Act III) lets workers share it on purpose. By default a port has one owner.") },
        { key: "fd", name: "Sockets are file descriptors", kind: "the real ceiling", color: "--c-port",
          cap: "Every connection is an fd. Concurrency is capped by <code>ulimit -n</code> (this demo host: 12), <b>not</b> by ports. This is the C10K problem.",
          detail: term("ulimit -n", "12") +
            term("# the accept that runs out of descriptors", "accept4(3, ...) = -1 EMFILE (Too many open files)") +
            note("Real servers raise <code>ulimit -n</code> to 100k+ and size the listen backlog. The lever is file descriptors and memory — never “more ports”.") }
      ]
    },

    /* ---------------- Act II — Outbound ---------------- */
    {
      num: "II", name: "Outbound",
      dek: "Now nginx is the client, dialing an upstream. Which side runs out first?",
      ss: "ss -tnp ; ss -tan state time-wait",
      init: function () { state.sockets = []; state.ephem = 32768; },
      actions: function () { return [
        { id: "open", label: "Open an upstream connection", run: openII },
        { id: "close", label: "Close one (→ TIME-WAIT)", run: closeII, enabled: countState("ESTAB") > 0 }
      ]; },
      ticket: function () { var a = countState("ESTAB"); return method("app") + '<span class="req-path">→ 10.0.0.9:<b>5432</b></span><span class="req-body">' + a + " outbound</span>"; },
      counters: function () { var a = countState("ESTAB"), tw = countState("TIME-WAIT"); return chip("--c-socket", a + " outbound") + chip("--c-listen", tw + " time-wait") + chip("--c-port", (a + tw) + " / ~28k src ports"); },
      stat: function () { return { html: "Each outbound connection borrows a local <b>source port</b>. Inbound, one port held unlimited sockets — outbound, every socket spends a port from a ~28k pool." }; },
      cards: [
        { key: "ephemeral", name: "Outbound flips the limit", kind: "ephemeral ports", color: "--c-port",
          cap: "Each outbound connection borrows a local <b>ephemeral source port</b>. To a single destination you get ~28k of them; exhaust the range and <code>connect()</code> fails.",
          detail: term("cat /proc/sys/net/ipv4/ip_local_port_range", "32768\t60999") +
            term("# too many short-lived conns to one 10.0.0.9:5432", "connect() = -1 EADDRNOTAVAIL (Cannot assign requested address)") +
            note("Inbound: one listening port, unlimited sockets. Outbound: each socket costs a source port, so the bottleneck moves to <b>your</b> side of the wire.") },
        { key: "timewait", name: "TIME-WAIT holds the port", kind: "~60 s", color: "--c-listen",
          cap: "A closed connection keeps its <b>source port</b> in TIME-WAIT for ~60s so late packets can't cross wires. Churn connections fast and you starve the pool.",
          detail: term("ss -tan state time-wait | wc -l", "11026") +
            note("The fix is connection <i>reuse</i> — HTTP keep-alive, a database pool — not more ports. A flood of short-lived connections to one upstream is the classic source-port squeeze.") }
      ]
    },

    /* ---------------- Act III — Scale ---------------- */
    {
      num: "III", name: "Scale",
      dek: "You need more throughput. Do you reach for more ports — or more sockets?",
      ss: "ss -tlnp '( sport = :80 )'",
      init: function () { state.workers = []; state.rr = 0; state.sockets = []; addWorker(); state.flash = null; },
      actions: function () { return [
        { id: "worker", label: "Add a worker (SO_REUSEPORT)", run: addWorkerAction },
        { id: "accept", label: "Accept a client", run: acceptIII }
      ]; },
      ticket: function () { var w = state.workers.length; return method("nginx") + '<span class="req-path">' + w + " worker" + (w === 1 ? "" : "s") + " on :<b>80</b></span><span class=\"req-body\">SO_REUSEPORT</span>"; },
      counters: function () { return chip("--c-listen", state.workers.length + " listening sockets") + chip("--c-socket", countState("ESTAB") + " connections") + chip("--c-port", "1 port · :80"); },
      stat: function () { return { html: "With <b>SO_REUSEPORT</b>, every worker <code>bind()</code>s the same :80. Many <b>listening</b> sockets, one port — the kernel spreads incoming connections across them." }; },
      cards: [
        { key: "reuseport", name: "Many listeners, one port", kind: "SO_REUSEPORT", color: "--c-listen",
          cap: "With <code>SO_REUSEPORT</code> each worker <code>bind()</code>s the same :80. N listening sockets, one port — the kernel load-balances new connections across them.",
          detail: term("ss -tlnp '( sport = :80 )'",
            'LISTEN 0 511 0.0.0.0:80 users:(("nginx",pid=812,fd=6))\n' +
            'LISTEN 0 511 0.0.0.0:80 users:(("nginx",pid=813,fd=6))\n' +
            'LISTEN 0 511 0.0.0.0:80 users:(("nginx",pid=814,fd=6))\n' +
            "# one port, three listening sockets — one per worker") +
            note("Each worker gets its own accept queue, so there is no single-accept lock across cores.") },
        { key: "scale", name: "Ports don't scale — sockets do", kind: "use every core", color: "--c-socket",
          cap: "You never add ports to handle load. You add workers, sockets, machines. The port is one address; throughput is sockets × cores × boxes.",
          detail: note("If you ever catch yourself thinking “I need another port for more traffic”, it's the socket / fd / worker budget you actually mean. One <code>:80</code> can front an entire fleet behind a load balancer.") }
      ]
    }
  ];

  function mk(o) { o.id = "s" + (idSeq++); o.fresh = true; return o; }
  function method(name) { return '<span class="req-method">' + esc(name) + "</span>"; }

  /* ---------- Act I actions ---------- */
  function acceptI() {
    var n = countKind("conn");
    if (n >= CONN_CAP) {
      state.flash = { reject: true, html: "<b>accept4(): Too many open files (24)</b> — the fd ceiling at <code>ulimit -n " + FD_LIMIT + "</code>. The port is fine; you're out of <b>sockets</b>." };
      state.spot = "fd"; return;
    }
    var client = "10.0.0." + rint(20, 250), sport = rint(49152, 65535), fd = 4 + n;
    state.sockets.push(mk({ state: "ESTAB", kind: "conn", lip: HOST, lport: 80, pip: client, pport: sport, proc: "nginx", pid: NGINX_PID, fd: fd }));
    state.flash = { html: "<code>accept()</code> → <b>fd " + fd + "</b> for " + client + ":" + sport + ". A brand-new socket — same port :80." };
    state.spot = "socket";
  }
  function closeI() {
    for (var i = state.sockets.length - 1; i >= 0; i--) {
      if (state.sockets[i].kind === "conn") { var s = state.sockets.splice(i, 1)[0];
        state.flash = { html: "<code>close(fd " + s.fd + ")</code> — that one socket is gone. The port and every other connection are untouched." };
        state.spot = null; return; }
    }
  }
  function secondNginx() {
    state.flash = { reject: true, html: "<b>nginx: [emerg] bind() to 0.0.0.0:80 failed (98: Address already in use)</b> — a port is bound <b>once</b>. This is not a connection limit." };
    state.spot = "bind";
  }

  /* ---------- Act II actions ---------- */
  function openII() {
    var active = countState("ESTAB"), tw = countState("TIME-WAIT");
    if (active + tw >= PORT_CAP) {
      state.flash = { reject: true, html: "<b>connect() to 10.0.0.9:5432 failed (99: Cannot assign requested address)</b> — no ephemeral <b>source ports</b> left; TIME-WAIT is still holding them." };
      state.spot = "ephemeral"; return;
    }
    var sport = state.ephem++, fd = 5 + active;
    state.sockets.push(mk({ state: "ESTAB", kind: "outbound", lip: HOST, lport: sport, pip: UP, pport: UP_PORT, proc: "app", pid: APP_PID, fd: fd }));
    state.flash = { html: "<code>connect()</code> → local <b>:" + sport + "</b> → 10.0.0.9:5432. This socket just spent one ephemeral <b>source</b> port." };
    state.spot = "ephemeral";
  }
  function closeII() {
    for (var i = state.sockets.length - 1; i >= 0; i--) {
      var s = state.sockets[i];
      if (s.state === "ESTAB") { s.state = "TIME-WAIT"; s.kind = "timewait"; s.proc = null; s.pid = null; s.fd = null; s.fresh = true;
        state.flash = { html: "<code>close()</code> → the socket enters <b>TIME-WAIT</b> for ~60s, still holding source port :" + s.lport + "." };
        state.spot = "timewait"; return; }
    }
  }

  /* ---------- Act III actions ---------- */
  function addWorker() {
    var pid = NGINX_PID + state.workers.length;
    state.workers.push({ pid: pid, fd: 6 });
    state.sockets.push(mk({ state: "LISTEN", kind: "listen", lip: "0.0.0.0", lport: 80, pip: "0.0.0.0", pport: "*", proc: "nginx", pid: pid, fd: 6 }));
    return pid;
  }
  function addWorkerAction() {
    if (state.workers.length >= 6) { state.flash = { html: "Six workers is plenty for the demo — the point stands at any N: they all share :80." }; state.spot = "reuseport"; return; }
    var pid = addWorker();
    state.flash = { html: "worker <b>pid " + pid + "</b> ran <code>bind(:80)</code> with <b>SO_REUSEPORT</b> — listening socket #" + state.workers.length + " on the same port." };
    state.spot = "reuseport";
  }
  function acceptIII() {
    if (!state.workers.length) addWorker();
    var w = state.workers[state.rr % state.workers.length]; state.rr++;
    var client = "10.0.0." + rint(20, 250), sport = rint(49152, 65535), fd = 10 + countState("ESTAB");
    state.sockets.push(mk({ state: "ESTAB", kind: "conn", lip: HOST, lport: 80, pip: client, pport: sport, proc: "nginx", pid: w.pid, fd: fd }));
    state.flash = { html: "the kernel handed this accept to <b>worker pid " + w.pid + "</b>. All workers share :80; the load spreads across them." };
    state.spot = "reuseport";
  }

  /* ============================================================ RENDER ============================================================ */
  var kicker = $("act-kicker"), dek = $("scenario"), ticketEl = $("req-label"),
      counters = $("counters"), tableBody = $("table-body"), tableStat = $("table-stat"),
      ssCmd = $("ss-cmd"), figNum = $("fig-num"), actionsEl = $("actions"), stackEl = $("stack");
  var actDots = Array.prototype.slice.call(document.querySelectorAll(".rdot[data-act]"));

  var state = { act: 0, sockets: [], flash: null, spot: null, ephem: 32768, workers: [], rr: 0, cardEls: {} };

  function sockRowHTML(s) {
    var proc = (s.state === "TIME-WAIT")
      ? '<span class="sfd">—</span>'
      : '<span class="sproc-name">' + esc(s.proc) + '</span> <span class="sfd">fd=' + s.fd + "</span>";
    return '<span class="srow-state">' + esc(s.state) + "</span>" +
      '<span class="local">' + esc(s.lip) + ':<span class="lport">' + s.lport + "</span></span>" +
      '<span class="peer">' + esc(peerOf(s)) + "</span>" +
      '<span class="sproc">' + proc + "</span>";
  }
  function renderTable() {
    tableBody.replaceChildren();
    state.sockets.forEach(function (s) {
      var el = document.createElement("div");
      el.className = "srow st-" + s.state + (s.fresh ? " fresh" : "");
      el.setAttribute("role", "listitem");
      el.innerHTML = sockRowHTML(s);
      tableBody.appendChild(el);
      s.fresh = false;
    });
  }

  function renderActions(list) {
    actionsEl.replaceChildren();
    list.forEach(function (a) {
      var b = document.createElement("button");
      b.className = "ghost act-btn" + (a.danger ? " danger" : "");
      b.textContent = a.label;
      b.disabled = a.enabled === false;
      b.addEventListener("click", function () { a.run(); render(); });
      actionsEl.appendChild(b);
    });
  }

  function renderCards(cards) {
    stackEl.replaceChildren(); state.cardEls = {};
    cards.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "lrow"; el.style.setProperty("--c", "var(" + c.color + ")");
      el.innerHTML =
        '<div class="lrow-card"><button class="lrow-head" aria-expanded="false">' +
          '<span class="lrow-sw"></span>' +
          '<span class="lrow-main"><span class="lrow-name">' + esc(c.name) + ' <b class="lkind">' + esc(c.kind) + "</b><span class=\"lrow-now\">◂ why</span></span>" +
          '<span class="lrow-cap">' + c.cap + "</span></span>" +
          '<span class="lrow-chev" aria-hidden="true">▸</span>' +
        "</button>" +
        '<div class="lrow-detail"><div class="lrow-detail-in">' + c.detail + "</div></div></div>";
      stackEl.appendChild(el); state.cardEls[c.key] = el;
      el.querySelector(".lrow-head").addEventListener("click", function () { toggleCard(c.key); });
    });
  }
  function setCardOpen(key, open) { var el = state.cardEls[key]; if (!el) return; el.classList.toggle("open", open); el.querySelector(".lrow-head").setAttribute("aria-expanded", open ? "true" : "false"); }
  function toggleCard(key) {
    var willOpen = !state.cardEls[key].classList.contains("open");
    Object.keys(state.cardEls).forEach(function (k) { if (k !== key) setCardOpen(k, false); });
    setCardOpen(key, willOpen);
  }

  function render() {
    var A = ACTS[state.act];
    kicker.textContent = "Act " + A.num + " · " + A.name;
    dek.textContent = A.dek;
    figNum.textContent = String(state.act + 1);
    ssCmd.textContent = A.ss;

    actDots.forEach(function (d, i) {
      var cur = i === state.act;
      d.classList.toggle("current", cur);
      d.classList.toggle("done", i < state.act);
      d.setAttribute("r", cur ? "6.5" : "5");
      d.style.fill = cur ? "var(--accent)" : "";
      d.style.color = cur ? "var(--accent)" : "";
      d.setAttribute("aria-current", cur ? "step" : "false");
    });

    ticketEl.innerHTML = A.ticket();
    ticketEl.classList.remove("pulse"); void ticketEl.offsetWidth; ticketEl.classList.add("pulse");
    counters.innerHTML = A.counters();

    renderTable();

    var st = state.flash || A.stat();
    tableStat.innerHTML = st.html;
    tableStat.classList.toggle("reject", !!st.reject);

    renderActions(A.actions());

    // spotlight + auto-open the relevant card
    Object.keys(state.cardEls).forEach(function (k) {
      var isSpot = k === state.spot;
      state.cardEls[k].classList.toggle("spotlight", isSpot);
      if (isSpot) setCardOpen(k, true);
    });

    $("prev").disabled = state.act === 0;
    $("next").disabled = state.act === ACTS.length - 1;
  }

  /* ---------- act navigation ---------- */
  function loadAct(i) {
    state.act = clamp(i, 0, ACTS.length - 1);
    state.sockets = []; state.flash = null; state.spot = null; state.ephem = 32768; state.workers = []; state.rr = 0;
    ACTS[state.act].init();
    renderCards(ACTS[state.act].cards);
    render();
    stage.scrollTo({ top: 0, behavior: "smooth" });
  }
  var stage = $("stage");
  $("prev").addEventListener("click", function () { if (state.act > 0) loadAct(state.act - 1); });
  $("next").addEventListener("click", function () { if (state.act < ACTS.length - 1) loadAct(state.act + 1); });
  $("reset").addEventListener("click", function () { loadAct(state.act); });

  actDots.forEach(function (d) {
    var i = parseInt(d.dataset.act, 10), A = ACTS[i];
    d.setAttribute("tabindex", "0");
    d.setAttribute("role", "button");
    d.setAttribute("aria-label", "Go to Act " + A.num + ": " + A.name);
    d.addEventListener("click", function () { loadAct(i); });
    d.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); loadAct(i); } });
  });

  /* ---------- guide ---------- */
  var help = $("help"), helpStart = $("help-start"), helpCard = help.querySelector(".sheet-card"), returnFocusTo = null;
  function openHelp(firstRun) {
    returnFocusTo = document.activeElement;
    helpStart.hidden = !firstRun;
    help.hidden = false;
    (firstRun ? helpStart : $("help-close")).focus();
  }
  function closeHelp() {
    help.hidden = true;
    if (returnFocusTo && typeof returnFocusTo.focus === "function") returnFocusTo.focus(); else stage.focus();
  }
  function keepFocusInHelp(e) {
    if (e.key !== "Tab" || help.hidden) return;
    var f = Array.prototype.slice.call(helpCard.querySelectorAll("button:not([hidden])"));
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  $("help-btn").addEventListener("click", function () { openHelp(false); });
  $("help-close").addEventListener("click", closeHelp);
  helpStart.addEventListener("click", closeHelp);

  document.addEventListener("keydown", function (e) {
    if (!help.hidden) { if (e.key === "Escape") closeHelp(); else keepFocusInHelp(e); return; }
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowRight") { e.preventDefault(); if (state.act < ACTS.length - 1) loadAct(state.act + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (state.act > 0) loadAct(state.act - 1); }
    else if (e.key === "Home") { e.preventDefault(); loadAct(0); }
    else if (e.key === "End") { e.preventDefault(); loadAct(ACTS.length - 1); }
  });

  /* ---------- init ---------- */
  loadAct(0);
  openHelp(true);
})();
