/* ============================================================
   Ports ≠ Sockets — one connection, three names.

   A single nginx TCP connection, shown through three lenses at once:

     WIRE     the remote host names it by its PORT          (tcpdump)
     KERNEL   the socket object itself — buffers, state     (ss)
     PROCESS  the process names it by a FILE DESCRIPTOR     (lsof)

   The socket sits in the middle: the port routes packets INTO it from the
   wire, the fd reads them OUT of it from the process, and socket:[inode]
   is the literal join key visible in both the kernel and the process.
   ============================================================ */
(function () {
  "use strict";

  var SERVER = "192.168.1.10", LPORT = 80, NGINX_PID = 1234, USER = "www-data";

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var rint = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); };

  function term(cmd, out) { return '<div class="term"><div class="term-cmd">' + esc("$ " + cmd) + '</div><pre class="term-out">' + esc(out) + "</pre></div>"; }
  function note(html) { return '<div class="ld-fields"><div class="ld-field">' + html + "</div></div>"; }
  function chip(colorVar, label) { return '<span class="tchip lit" style="--tc:var(' + colorVar + ')">' + esc(label) + "</span>"; }

  /* ---------- the model: a listening socket + established connections ----------
     Each entity is one connection, rendered three ways. Every entity carries
     all three names at once: its ports, its kernel socket inode, its fd. */
  var CONN_CAP = 5;
  var state = { entities: [], selected: null, fdNext: 5, inodeNext: 12347, gsn: null, flash: null };

  function reset() {
    state.entities = [
      { id: "listen", kind: "listen", lport: LPORT, pip: null, pport: null, fd: 3, inode: 11001, tcp: "LISTEN" },
      { id: "c0", kind: "conn", lport: LPORT, pip: "10.0.0.55", pport: 54321, fd: 4, inode: 12346, tcp: "ESTAB" }
    ];
    state.selected = "c0"; state.fdNext = 5; state.inodeNext = 12347; state.gsn = null;
    state.flash = { html: "One TCP connection, named three ways. Click a row in any lens — the same connection lights up in all three." };
  }
  function conns() { return state.entities.filter(function (e) { return e.kind === "conn"; }); }
  function byId(id) { for (var i = 0; i < state.entities.length; i++) if (state.entities[i].id === id) return state.entities[i]; return null; }

  function accept() {
    if (conns().length >= CONN_CAP) { state.flash = { html: "Keeping it to a handful for the demo — the point holds at any N: every connection is one more socket, one more fd, still port :80 on the wire." }; return; }
    var e = { id: "c" + (idc++), kind: "conn", lport: LPORT, pip: "10.0.0." + rint(20, 250), pport: rint(49152, 65535), fd: state.fdNext++, inode: state.inodeNext++, tcp: "ESTAB", fresh: true };
    state.entities.push(e); state.selected = e.id; state.gsn = null;
    state.flash = { html: "<code>accept()</code> returned <b>fd " + e.fd + "</b>. The connection now exists in all three lenses at once — a flow on the wire, <code>socket:[" + e.inode + "]</code> in the kernel, fd " + e.fd + " in nginx." };
  }
  function closeConn() {
    var c = conns();
    if (!c.length) { state.flash = { reject: true, html: "No client connections to close — only the listening socket is left." }; return; }
    var last = c[c.length - 1];
    state.entities = state.entities.filter(function (e) { return e.id !== last.id; });
    state.selected = conns().length ? conns()[conns().length - 1].id : "listen";
    state.gsn = null;
    state.flash = { html: "<code>close(fd " + last.fd + ")</code> — the fd is released and the kernel tears the socket down. Port :80 is untouched; it was never this connection's to hold." };
  }
  function getsockname() {
    var e = byId(state.selected); if (!e) return;
    var pretty = e.kind === "listen" ? "the listening socket" : e.pip + ":" + e.pport;
    state.gsn = { fd: e.fd, lport: e.lport, label: pretty };
    state.flash = { html: "nginx held only <b>fd " + e.fd + "</b>. To name its own port it had to <b>ask the kernel</b> — <code>getsockname()</code> is a syscall; the port isn't in user space." };
  }
  var idc = 1;

  /* ---------- render one entity in each lens's idiom ---------- */
  function wireRow(e) {
    if (e.kind === "listen")
      return '<span class="tok-muted">' + SERVER + ':</span><span class="tok-port">' + e.lport + '</span><span class="tok-muted">  — clients dial this address</span>';
    return '<span class="tok-muted">' + SERVER + ':</span><span class="tok-port">' + e.lport + '</span>' +
      '<span class="tok-muted"> → </span>' +
      '<span class="tok-muted">' + e.pip + ':</span><span class="tok-port">' + e.pport + '</span>';
  }
  function kernelRow(e) {
    var addrs = e.kind === "listen" ? "0.0.0.0:" + e.lport : SERVER + ":" + e.lport + " " + e.pip + ":" + e.pport;
    return '<span class="tok-state">' + e.tcp + '</span> ' +
      '<span class="tok-muted">' + esc(addrs) + '</span> ' +
      '<span class="tok-sock">socket:[' + e.inode + ']</span>';
  }
  function procRow(e) {
    return '<span class="tok-fd">fd ' + e.fd + '</span>' +
      '<span class="tok-muted"> → </span>' +
      '<span class="tok-sock">socket:[' + e.inode + ']</span>' +
      (e.kind === "listen" ? '<span class="tok-muted">  (LISTEN)</span>' : '<span class="tok-muted">  read(' + e.fd + ")/write(" + e.fd + ")</span>");
  }

  var wireBody = $("wire-body"), kernelBody = $("kernel-body"), procBody = $("proc-body");
  function fillLens(bodyEl, builder) {
    bodyEl.replaceChildren();
    state.entities.forEach(function (e) {
      var row = document.createElement("div");
      row.className = "lens-row" + (e.id === state.selected ? " sel" : "") + (e.fresh ? " fresh" : "");
      row.setAttribute("role", "button"); row.setAttribute("tabindex", "0");
      row.setAttribute("aria-label", "Select the " + (e.kind === "listen" ? "listening socket" : "connection to " + e.pip + ":" + e.pport));
      row.innerHTML = builder(e);
      row.addEventListener("click", function () { select(e.id); });
      row.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); select(e.id); } });
      bodyEl.appendChild(row);
    });
  }

  function select(id) { state.selected = id; state.gsn = null; render(); }

  /* ---------- render everything ---------- */
  var ticket = $("req-label"), names = $("names"), status = $("status");
  var linkTop = $("link-top"), linkBot = $("link-bot"), gsnEl = $("gsn");

  function render() {
    var n = conns().length;
    ticket.innerHTML = '<span class="req-method">nginx</span><span class="req-path">listening on :<b>' + LPORT + '</b></span><span class="req-body">' + n + " connection" + (n === 1 ? "" : "s") + "</span>";

    var e = byId(state.selected) || state.entities[0];
    // the selected connection's three names, colour-coded per lens
    var portChip = e.kind === "listen" ? ":" + e.lport : ":" + e.lport + " ↔ :" + e.pport;
    names.innerHTML = chip("--c-port", "port " + portChip) + chip("--c-socket", "socket:[" + e.inode + "]") + chip("--c-tuple", "fd " + e.fd);

    fillLens(wireBody, wireRow);
    fillLens(kernelBody, kernelRow);
    fillLens(procBody, procRow);
    state.entities.forEach(function (x) { x.fresh = false; });

    // the connecting thread, labelled for the selected connection
    linkTop.querySelector(".link-label").innerHTML = "port ↓ · kernel demuxes the packet by (src, sport, dst, dport, proto) into <b>socket:[" + e.inode + "]</b>";
    linkBot.querySelector(".link-label").innerHTML = "fd ↑ · nginx <b>fd " + e.fd + "</b> → <b>socket:[" + e.inode + "]</b>";
    linkTop.classList.add("hot"); linkBot.classList.add("hot");

    // getsockname readout, when asked
    if (state.gsn) {
      gsnEl.hidden = false;
      gsnEl.innerHTML = term("strace -p " + NGINX_PID + " -e trace=getsockname",
        "getsockname(" + state.gsn.fd + ", {sa_family=AF_INET, sin_port=htons(" + state.gsn.lport + "), " +
        'sin_addr=inet_addr("' + SERVER + '")}, [16]) = 0');
    } else { gsnEl.hidden = true; gsnEl.innerHTML = ""; }

    var st = state.flash;
    status.innerHTML = st ? st.html : "";
    status.classList.toggle("reject", !!(st && st.reject));

    $("close").disabled = n === 0;
  }

  /* ---------- the "why it matters" cards ---------- */
  var CARDS = [
    { key: "port", name: "The port is routing, not a handle", kind: "on the wire", color: "--c-port",
      cap: "A port names the endpoint on the wire, so the remote host — and the kernel's demux — can find the socket. Once <code>accept()</code> returns, the port is gone from user space.",
      detail: term("tcpdump -ni any 'tcp port 80'",
        "192.168.1.10.80 > 10.0.0.55.54321: Flags [P.], seq 1:43, length 42\n" +
        "10.0.0.55.54321 > 192.168.1.10.80: Flags [.], ack 43, length 0") +
        note("On the wire a connection <i>is</i> its ports and IPs — that's routing information the kernel matches against, not a token the process carries around.") },
    { key: "fd", name: "The fd is the process's token", kind: "in user space", color: "--c-tuple",
      cap: "nginx <code>read()</code>/<code>write()</code>s <b>fd 4</b> and never names :80 again. The port isn't in its address space; to recover it the process must <code>getsockname()</code> — a syscall.",
      detail: term("lsof -p 1234",
        "COMMAND  PID     USER  FD  TYPE DEVICE NODE NAME\n" +
        "nginx   1234 www-data   3u IPv4  11001  TCP *:80 (LISTEN)\n" +
        "nginx   1234 www-data   4u IPv4  12346  TCP 192.168.1.10:80->10.0.0.55:54321 (ESTABLISHED)") +
        note("The <code>*:80</code> text is reconstructed by lsof from <code>/proc/1234/fd/4</code> → the kernel socket. The fd table itself just holds “fd 4 → socket object”.") },
    { key: "socket", name: "The socket is the shared object", kind: "in the kernel", color: "--c-socket",
      cap: "The kernel socket — buffers, TCP state, the 5-tuple — is the reality both sides point at. <code>socket:[12346]</code> is the join: the port routes packets <b>into</b> it, the fd reads <b>out</b> of it.",
      detail: term("ss -tenp",
        "ESTAB 0 0 192.168.1.10:80 10.0.0.55:54321\n" +
        '      ino:12346 sk:2 <-> users:(("nginx",pid=1234,fd=4))') +
        note("One object, two names: the wire calls it <code>:80 ↔ :54321</code>, the process calls it <code>fd 4</code>. Change the port and packets miss it; close the fd and the process loses its grip — but it's the same socket in the middle.") }
  ];
  var stackEl = $("stack"), cardEls = {};
  function buildCards() {
    stackEl.replaceChildren(); cardEls = {};
    CARDS.forEach(function (c) {
      var el = document.createElement("div");
      el.className = "lrow"; el.style.setProperty("--c", "var(" + c.color + ")");
      el.innerHTML =
        '<div class="lrow-card"><button class="lrow-head" aria-expanded="false">' +
          '<span class="lrow-sw"></span>' +
          '<span class="lrow-main"><span class="lrow-name">' + esc(c.name) + ' <b class="lkind">' + esc(c.kind) + "</b></span>" +
          '<span class="lrow-cap">' + c.cap + "</span></span>" +
          '<span class="lrow-chev" aria-hidden="true">▸</span>' +
        "</button>" +
        '<div class="lrow-detail"><div class="lrow-detail-in">' + c.detail + "</div></div></div>";
      stackEl.appendChild(el); cardEls[c.key] = el;
      el.querySelector(".lrow-head").addEventListener("click", function () { toggleCard(c.key); });
    });
  }
  function setCardOpen(key, open) { var el = cardEls[key]; el.classList.toggle("open", open); el.querySelector(".lrow-head").setAttribute("aria-expanded", open ? "true" : "false"); }
  function toggleCard(key) {
    var willOpen = !cardEls[key].classList.contains("open");
    Object.keys(cardEls).forEach(function (k) { if (k !== key) setCardOpen(k, false); });
    setCardOpen(key, willOpen);
  }

  /* ---------- controls ---------- */
  $("accept").addEventListener("click", function () { accept(); render(); });
  $("close").addEventListener("click", function () { closeConn(); render(); });
  $("reset").addEventListener("click", function () { reset(); render(); });
  $("gsn-btn").addEventListener("click", function () { getsockname(); render(); });

  /* ---------- guide ---------- */
  var help = $("help"), helpStart = $("help-start"), helpCard = help.querySelector(".sheet-card"), stage = $("stage"), returnFocusTo = null;
  function openHelp(firstRun) { returnFocusTo = document.activeElement; helpStart.hidden = !firstRun; help.hidden = false; (firstRun ? helpStart : $("help-close")).focus(); }
  function closeHelp() { help.hidden = true; if (returnFocusTo && typeof returnFocusTo.focus === "function") returnFocusTo.focus(); else stage.focus(); }
  function keepFocusInHelp(ev) {
    if (ev.key !== "Tab" || help.hidden) return;
    var f = Array.prototype.slice.call(helpCard.querySelectorAll("button:not([hidden])"));
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
  }
  $("help-btn").addEventListener("click", function () { openHelp(false); });
  $("help-close").addEventListener("click", closeHelp);
  helpStart.addEventListener("click", closeHelp);

  document.addEventListener("keydown", function (ev) {
    if (!help.hidden) { if (ev.key === "Escape") closeHelp(); else keepFocusInHelp(ev); return; }
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA" || tag === "BUTTON") return;
    if (ev.key === "a" || ev.key === "A") { accept(); render(); }
    else if (ev.key === "x" || ev.key === "X") { closeConn(); render(); }
  });

  /* ---------- init ---------- */
  reset(); buildCards(); render();
  openHelp(true);
})();
