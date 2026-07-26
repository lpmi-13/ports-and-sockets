/* ============================================================
   Ports ≠ Sockets — a dense, interactive demux anatomy.

   One packet arrives at a Linux host and climbs the stack. The live
   kernel socket table narrows, field by field, from "every socket that
   shares this port" down to the single socket that receives the bytes —
   because a PORT is only a number the kernel looks up, while a SOCKET is
   the endpoint that actually holds the data.

   Prev / Next (or ← →) walk the seven steps; tap a socket row to inspect
   it; tap an anatomy row to see its real fields as ss / tcpdump / proc
   would show them; 🎲 New packet generates a fresh arrival.
   ============================================================ */
(function () {
  "use strict";

  var HOST = "10.0.0.1";
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var $ = function (id) { return document.getElementById(id); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var rint = function (a, b) { return a + Math.floor(Math.random() * (b - a + 1)); };
  var pick = function (a) { return a[Math.floor(Math.random() * a.length)]; };

  /* ---------- the host's baseline sockets ----------
     A pair of established web connections behind one listener, an ssh
     listener, and a UDP resolver — enough to show that a port is a shared
     bucket, not a connection. */
  function baseTable() {
    return [
      { id: "l80", state: "LISTEN", proto: "tcp", recvq: 0, sendq: 128, lip: "0.0.0.0", lport: 80, pip: "0.0.0.0", pport: "*", proc: "nginx",   pid: 812, fd: 6 },
      { id: "c1",  state: "ESTAB",  proto: "tcp", recvq: 0, sendq: 0,   lip: HOST,      lport: 80, pip: "10.0.0.55", pport: 54321, proc: "nginx", pid: 814, fd: 12 },
      { id: "c2",  state: "ESTAB",  proto: "tcp", recvq: 0, sendq: 0,   lip: HOST,      lport: 80, pip: "10.0.0.66", pport: 12345, proc: "nginx", pid: 815, fd: 15 },
      { id: "l22", state: "LISTEN", proto: "tcp", recvq: 0, sendq: 128, lip: "0.0.0.0", lport: 22, pip: "0.0.0.0", pport: "*", proc: "sshd",    pid: 701, fd: 4 },
      { id: "d53", state: "UNCONN", proto: "udp", recvq: 0, sendq: 0,   lip: "0.0.0.0", lport: 53, pip: "0.0.0.0", pport: "*", proc: "systemd-resolve", pid: 640, fd: 8 }
    ];
  }
  var newClient = function () { return "10.0.0." + rint(100, 250); };
  var ephemeral = function () { return rint(49152, 65535); };

  /* ---------- packet catalogue ----------
     Each returns just the packet; resolve() derives the demux outcome from
     the table, so the narration can never disagree with what's on screen. */
  function estabData()  { return { proto: "tcp", sip: "10.0.0.55", sport: 54321, dip: HOST, dport: 80, kind: "data", bytes: pick([140, 512, 733]), flags: "[P.]", seq: rint(1e6, 9e6), scen: "An established connection sends more data." }; }
  function estabData2() { return { proto: "tcp", sip: "10.0.0.66", sport: 12345, dip: HOST, dport: 80, kind: "data", bytes: pick([96, 428, 1024]), flags: "[P.]", seq: rint(1e6, 9e6), scen: "A different client on the same port :80." }; }
  function synNew()     { return { proto: "tcp", sip: newClient(), sport: ephemeral(), dip: HOST, dport: 80, kind: "SYN", bytes: 0, flags: "[S]", seq: rint(1e6, 9e6), scen: "A brand-new client opens a connection to :80." }; }
  function udpDns()     { return { proto: "udp", sip: newClient(), sport: ephemeral(), dip: HOST, dport: 53, kind: "datagram", bytes: pick([32, 41, 58]), flags: "", seq: 0, scen: "A UDP DNS query — connectionless." }; }
  function sshNew()     { return { proto: "tcp", sip: newClient(), sport: ephemeral(), dip: HOST, dport: 22, kind: "SYN", bytes: 0, flags: "[S]", seq: rint(1e6, 9e6), scen: "Someone opens an SSH connection to :22." }; }
  function closedTcp()  { return { proto: "tcp", sip: newClient(), sport: ephemeral(), dip: HOST, dport: pick([81, 8080, 3000]), kind: "SYN", bytes: 0, flags: "[S]", seq: rint(1e6, 9e6), scen: "A SYN to a port with nothing bound." }; }
  function closedUdp()  { return { proto: "udp", sip: newClient(), sport: ephemeral(), dip: HOST, dport: pick([9999, 5000]), kind: "datagram", bytes: pick([30, 64]), flags: "", seq: 0, scen: "A UDP datagram to a port nobody owns." }; }
  function wrongHost()  { return { proto: "tcp", sip: newClient(), sport: ephemeral(), dip: "10.0.0.9", dport: 80, kind: "SYN", bytes: 0, flags: "[S]", seq: rint(1e6, 9e6), scen: "A packet whose destination IP isn't this host." }; }

  // weighted: the common "established data" case is the anchor; edge cases stay rare.
  var CATALOG = [estabData, estabData, estabData2, synNew, synNew, udpDns, sshNew, closedTcp, closedUdp, wrongHost];

  var fdSeq = 18;
  function resolve(packet) {
    var table = baseTable();
    var R = { packet: packet, table: table, bucketIds: {}, matchId: null, deliverId: null, newSocket: null, outcome: null };

    // L3 — is this packet even for us?
    if (packet.dip !== HOST) { R.outcome = "drop"; return R; }

    // L4 — the "port bucket": sockets bound to (proto, dport) on this host.
    var bucket = table.filter(function (s) { return s.proto === packet.proto && s.lport === packet.dport && (s.lip === HOST || s.lip === "0.0.0.0"); });
    bucket.forEach(function (s) { R.bucketIds[s.id] = true; });

    if (bucket.length === 0) { R.outcome = packet.proto === "tcp" ? "reset" : "unreach"; return R; }

    if (packet.proto === "tcp") {
      var estab = bucket.filter(function (s) { return s.state === "ESTAB" && s.pip === packet.sip && s.pport === packet.sport; })[0];
      if (estab) { R.outcome = "deliver"; R.matchId = estab.id; R.deliverId = estab.id; return R; }
      var listen = bucket.filter(function (s) { return s.state === "LISTEN"; })[0];
      if (listen && packet.kind === "SYN") {
        R.outcome = "accept"; R.matchId = listen.id;
        R.newSocket = { id: "new", state: "ESTAB", proto: "tcp", recvq: 0, sendq: 0, lip: HOST, lport: packet.dport,
          pip: packet.sip, pport: packet.sport, proc: listen.proc, pid: listen.pid, fd: fdSeq++ };
        R.deliverId = "new"; return R;
      }
      R.outcome = "reset"; return R;   // data with no matching connection → RST
    }

    // UDP — connectionless: the single socket on this port serves every peer.
    var u = bucket.filter(function (s) { return s.state === "UNCONN"; })[0] || bucket[0];
    R.outcome = "deliver"; R.matchId = u.id; R.deliverId = u.id; return R;
  }

  /* ---------- the seven steps of the climb ---------- */
  var NODES = [
    { icon: "📡", name: "Wire",    sub: "bytes arriving" },
    { icon: "🔗", name: "NIC",     sub: "L2 · link" },
    { icon: "🧭", name: "IP",      sub: "L3 · dst ip" },
    { icon: "🔢", name: "Port",    sub: "L4 · lookup" },
    { icon: "🎯", name: "Demux",   sub: "5-tuple match" },
    { icon: "📥", name: "Socket",  sub: "recv buffer" },
    { icon: "⚙️", name: "Process", sub: "recv()" }
  ];
  var MAXSTEP = NODES.length - 1;
  var SPOTLIGHT = { 3: "port", 4: "tuple", 5: "socket", 6: "socket" };

  /* ---------- header / field anatomy diagrams ---------- */
  var TCP_ROWS = [
    { cells: [ { label: "Source port", w: 16, sub: "16 b" }, { label: "Destination port", w: 16, sub: "16 b", hi: true } ] },
    { cells: [ { label: "Sequence number", w: 32, sub: "32 b" } ] },
    { cells: [ { label: "Acknowledgement number", w: 32, sub: "32 b" } ] },
    { cells: [ { label: "Offset", w: 4, sub: "4 b" }, { label: "Rsvd", w: 4, sub: "4 b" }, { label: "Flags", w: 8, flags: ["URG", "ACK", "PSH", "RST", "SYN", "FIN"] }, { label: "Window", w: 16, sub: "16 b" } ] },
    { cells: [ { label: "Checksum", w: 16, sub: "16 b" }, { label: "Urgent pointer", w: 16, sub: "16 b" } ] }
  ];
  var UDP_ROWS = [
    { cells: [ { label: "Source port", w: 16, sub: "16 b" }, { label: "Destination port", w: 16, sub: "16 b", hi: true } ] },
    { cells: [ { label: "Length", w: 16, sub: "16 b" }, { label: "Checksum", w: 16, sub: "16 b" } ] }
  ];
  function diagram(title, colorVar, rows) {
    var html = '<div class="hf" style="--a:var(' + colorVar + ')"><div class="hf-title">' + esc(title) + "</div>";
    rows.forEach(function (row) {
      html += '<div class="hf-row">';
      row.cells.forEach(function (cell) {
        var body = '<span class="hf-l">' + esc(cell.label) + "</span>";
        if (cell.flags) body += '<span class="hf-flags">' + cell.flags.map(function (f) { return "<span>" + esc(f) + "</span>"; }).join("") + "</span>";
        else if (cell.sub) body += '<span class="hf-s">' + esc(cell.sub) + "</span>";
        html += '<div class="hf-c' + (cell.hi ? " hi" : "") + (cell.variable ? " hf-var" : "") + '" style="flex:' + cell.w + '">' + body + "</div>";
      });
      html += "</div>";
    });
    return html + "</div>";
  }
  function tupleDiagram(p) {
    var rows = [ { cells: [
      { label: p.proto.toUpperCase(), w: 8, sub: "proto" },
      { label: p.sip, w: 22, sub: "src ip" },
      { label: ":" + p.sport, w: 12, sub: "src port" },
      { label: p.dip, w: 22, sub: "dst ip" },
      { label: ":" + p.dport, w: 12, sub: "dst port", hi: true }
    ] } ];
    return diagram("connection identity · the socket's key", "--c-tuple", rows);
  }
  function term(cmd, out) { return '<div class="term"><div class="term-cmd">' + esc("$ " + cmd) + '</div><pre class="term-out">' + esc(out) + "</pre></div>"; }
  function fields(list) { return '<div class="ld-fields">' + list.map(function (f) { return '<div class="ld-field">' + f + "</div>"; }).join("") + "</div>"; }
  var peerOf = function (s) { return s.pip + ":" + s.pport; };
  var localOf = function (s) { return s.lip + ":" + s.lport; };

  /* ---------- the four anatomy rows (number vs. endpoint) ---------- */
  var STACK = [
    { key: "port",   name: "Port",   kind: "the number", color: "--c-port",
      cap: "A 16-bit value in the packet header. No buffer, no state, no owner — just a label the kernel looks up." },
    { key: "tuple",  name: "5-tuple", kind: "the key", color: "--c-tuple",
      cap: "proto · src ip · src port · dst ip · dst port. The full identity the kernel hashes to find one socket." },
    { key: "socket", name: "Socket", kind: "the endpoint", color: "--c-socket",
      cap: "A kernel object with receive & send buffers, protocol state and a file descriptor. This is what holds your data." },
    { key: "listen", name: "Listening vs connected", kind: "one : many", color: "--c-listen",
      cap: "One LISTEN socket accepts many clients; each accepted client gets its own connected socket — same local port, different peer." }
  ];

  function portDetail(p) {
    var isTcp = p.proto === "tcp";
    var f = fields([
      'destination port <b style="color:var(--c-port)">' + esc(":" + p.dport) + "</b> <span class=\"k\">· 16 bits, one field of the " + esc(p.proto.toUpperCase()) + " header</span>",
      "it names <i>which service</i>, never <i>which connection</i> — a socket is what a connection lives in",
      "thousands of packets can carry :" + esc(p.dport) + " at once; the number alone is ambiguous"
    ]);
    var d = diagram((isTcp ? "TCP" : "UDP") + " header · destination port highlighted", "--c-port", isTcp ? TCP_ROWS : UDP_ROWS);
    var t = term("tcpdump -ni eth0 '" + p.proto + " dst port " + p.dport + "'",
      p.sip + "." + p.sport + " > " + HOST + "." + p.dport + ": " + (isTcp ? p.flags + " " : "UDP, ") + "length " + p.bytes + "\n" +
      "10.0.0.55.54321 > " + HOST + "." + p.dport + ": [P.] length 512\n" +
      "10.0.0.66.12345 > " + HOST + "." + p.dport + ": [P.] length 340\n" +
      "# same :" + p.dport + " — three different sockets");
    return f + d + t;
  }
  function tupleDetail(p) {
    var f = fields([
      '<span class="k">proto </span>' + esc(p.proto.toUpperCase()),
      '<span class="k">src   </span>' + esc(p.sip + ":" + p.sport),
      '<span class="k">dst   </span>' + esc(p.dip + ":") + '<b style="color:var(--c-port)">' + esc(p.dport) + "</b>",
      "the kernel hashes this tuple to pick a socket — change any field and it's a different endpoint"
    ]);
    var d = tupleDiagram(p);
    var t = p.proto === "tcp"
      ? term("ss -tnp state established 'dst " + p.sip + ":" + p.sport + "'",
          "ESTAB 0 0 " + HOST + ":" + p.dport + " " + p.sip + ":" + p.sport + "\n# exactly one socket matches all five fields")
      : term("ss -unp 'dst " + p.sip + ":" + p.sport + "'",
          "UNCONN 0 0 " + HOST + ":" + p.dport + " " + p.sip + ":" + p.sport + "\n# UDP: matched on local ip:port, peer optional");
    return f + d + t;
  }
  function socketDetail(s, p) {
    if (!s) {
      return fields([
        "no socket owns this 5-tuple",
        "there is no endpoint here to hold the bytes — the port number pointed at nothing"
      ]) + term("ss -tnp 'dst " + p.sip + ":" + p.sport + "'", "(no matching socket)");
    }
    var f = fields([
      'fd <b style="color:var(--c-socket)">' + s.fd + "</b> <span class=\"k\">· state " + esc(s.state) + "</span>",
      '<span class="k">recv-buffer </span>' + s.recvq + ' B queued<span class="k">  ·  send-buffer </span>' + s.sendq + " B",
      '<span class="k">owner </span>' + esc(s.proc) + " <span class=\"k\">(pid " + s.pid + ")</span>",
      '<span class="k">local </span>' + esc(localOf(s)) + '<span class="k">   peer </span>' + esc(peerOf(s))
    ]);
    var t = term("ss -tiepm 'dst " + s.pip + ":" + s.pport + "'",
      s.state + " " + s.recvq + " " + s.sendq + " " + localOf(s) + " " + peerOf(s) +
      ' users:(("' + s.proc + '",pid=' + s.pid + ",fd=" + s.fd + "))\n" +
      "  skmem:(r0,rb131072,t0,tb16384) cubic rtt:0.4/0.2");
    var t2 = term("ls -l /proc/" + s.pid + "/fd/" + s.fd,
      "lrwx------ 1 root root 64 " + s.proc + " " + s.fd + " -> socket:[" + (38000 + s.fd * 7) + "]");
    return f + t + t2;
  }
  function listenDetail(p, table) {
    var conns = table.filter(function (s) { return s.state === "ESTAB" && s.lport === p.dport; });
    if (p.proto === "udp") {
      var u = table.filter(function (s) { return s.state === "UNCONN" && s.lport === p.dport; })[0];
      return fields([
        u ? "one UDP socket on :" + p.dport + " serves <b>every</b> peer" : "no UDP socket on :" + p.dport,
        "UDP is connectionless — there are no per-connection sockets, so :" + p.dport + " maps to a single endpoint"
      ]) + term("ss -aunp | grep :" + p.dport,
        u ? "UNCONN 0 0 " + localOf(u) + " 0.0.0.0:* users:((\"" + u.proc + "\",pid=" + u.pid + ",fd=" + u.fd + "))" : "(nothing bound)");
    }
    var listener = table.filter(function (s) { return s.state === "LISTEN" && s.lport === p.dport; })[0];
    return fields([
      listener
        ? '<b>1</b> listening socket on :' + p.dport + '  →  <b>' + conns.length + '</b> connected socket' + (conns.length === 1 ? "" : "s") + ", all sharing :" + p.dport
        : "nothing is listening on :" + p.dport,
      "each connection has its own fd, buffers and 5-tuple — the port is shared, the sockets are not"
    ]) + term("ss -tlnp | grep :" + p.dport,
      listener ? "LISTEN 0 128 " + localOf(listener) + " 0.0.0.0:* users:((\"" + listener.proc + "\",pid=" + listener.pid + ",fd=" + listener.fd + "))" : "(no listener)") +
      (conns.length ? term("ss -tnp state established '( sport = :" + p.dport + " )'",
        conns.map(function (c) { return "ESTAB 0 0 " + localOf(c) + " " + peerOf(c) + '  fd=' + c.fd; }).join("\n")) : "");
  }

  /* ---------- DOM ---------- */
  var stage = $("stage"), reqLabel = $("req-label"), tupleChips = $("tuple-chips");
  var epWire = $("ep-wire"), epProc = $("ep-proc");
  var phaseTag = $("phase-tag"), phaseNode = $("phase-node");
  var tableBody = $("table-body"), tableStat = $("table-stat"), stackEl = $("stack");
  var railDots = Array.prototype.slice.call(document.querySelectorAll(".rdot"));

  // build the anatomy stack scaffolding once
  var rowEls = {};
  STACK.forEach(function (row) {
    var el = document.createElement("div");
    el.className = "lrow";
    el.style.setProperty("--c", "var(" + row.color + ")");
    el.innerHTML =
      '<div class="lrow-card">' +
        '<button class="lrow-head" aria-expanded="false">' +
          '<span class="lrow-sw"></span>' +
          '<span class="lrow-main"><span class="lrow-name">' + esc(row.name) +
            ' <b class="lkind">' + esc(row.kind) + "</b><span class=\"lrow-now\">◂ now</span></span>" +
            '<span class="lrow-cap">' + esc(row.cap) + "</span></span>" +
          '<span class="lrow-bytes"></span>' +
          '<span class="lrow-chev" aria-hidden="true">▸</span>' +
        "</button>" +
        '<div class="lrow-detail"><div class="lrow-detail-in"></div></div>' +
      "</div>";
    stackEl.appendChild(el);
    rowEls[row.key] = el;
    el.querySelector(".lrow-head").addEventListener("click", function () { toggleRow(row.key); });
  });

  var CHIPS = [
    { key: "proto", cls: "proto" }, { key: "sip", cls: "sip" }, { key: "sport", cls: "sport" },
    { key: "dip", cls: "dip" }, { key: "dport", cls: "dport" }
  ];

  /* ---------- state ---------- */
  var R = resolve(estabData());   // deterministic-ish anchor for first load
  var step = 0, selectedId = R.deliverId, playTimer = null;
  var sockRows = {}, newRowEl = null;

  function litChips(s) {
    if (s < 2) return {};
    if (s === 2) return { proto: 1, dip: 1 };
    if (s === 3) return { proto: 1, dip: 1, dport: 1 };
    return { proto: 1, dip: 1, dport: 1, sip: 1, sport: 1 };
  }

  function makeRow(sock) {
    var el = document.createElement("div");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Inspect socket: " + sock.state + " " + localOf(sock) + " peer " + peerOf(sock) + ", " + sock.proc + " fd " + sock.fd);
    el.innerHTML =
      '<span class="srow-state">' + esc(sock.state) + "</span>" +
      '<span class="num recvq">' + sock.recvq + "</span>" +
      '<span class="num">' + sock.sendq + "</span>" +
      '<span class="local">' + esc(sock.lip) + ':<span class="lport">' + sock.lport + "</span></span>" +
      '<span class="peer">' + esc(peerOf(sock)) + "</span>" +
      '<span class="sproc"><span class="sproc-name">' + esc(sock.proc) + '</span> <span class="sfd">fd=' + sock.fd + "</span></span>";
    el.addEventListener("click", function () { selectSocket(sock.id); });
    el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectSocket(sock.id); } });
    return el;
  }

  function applyPacket() {
    // packet pill
    reqLabel.innerHTML =
      '<span class="req-method' + (R.packet.proto === "udp" ? " udp" : "") + '">' + esc(R.packet.proto.toUpperCase()) + "</span>" +
      '<span class="req-path">' + esc(R.packet.sip + ":" + R.packet.sport + " → " + R.packet.dip + ":") + "<b>" + esc(R.packet.dport) + "</b></span>" +
      '<span class="req-body">' + esc(R.packet.kind) + "</span>";
    reqLabel.classList.remove("pulse"); void reqLabel.offsetWidth; reqLabel.classList.add("pulse");

    // tuple chips
    tupleChips.innerHTML = [
      '<span class="tchip proto">' + esc(R.packet.proto.toUpperCase()) + "</span>",
      '<span class="tchip sip">src ' + esc(R.packet.sip) + "</span>",
      '<span class="tchip sport">:' + esc(R.packet.sport) + "</span>",
      '<span class="tchip dip">dst ' + esc(R.packet.dip) + "</span>",
      '<span class="tchip dport">:' + esc(R.packet.dport) + "</span>"
    ].join("");

    // socket table rows
    tableBody.replaceChildren();
    sockRows = {};
    R.table.forEach(function (sock) { var el = makeRow(sock); tableBody.appendChild(el); sockRows[sock.id] = { el: el, sock: sock }; });
    newRowEl = R.newSocket ? makeRow(R.newSocket) : null;

    // static anatomy details
    setBytes("port", "16 bits");
    setDetail("port", portDetail(R.packet));
    setBytes("tuple", "~104 bits");
    setDetail("tuple", tupleDetail(R.packet));
    setBytes("listen", listenBadge());
    setDetail("listen", listenDetail(R.packet, R.table));
    refreshSocketDetail();
    STACK.forEach(function (r) { setRowOpen(r.key, false); });
  }

  function listenBadge() {
    if (R.packet.proto === "udp") return "1 : ∞";
    var conns = R.table.filter(function (s) { return s.state === "ESTAB" && s.lport === R.packet.dport; }).length;
    var hasL = R.table.some(function (s) { return s.state === "LISTEN" && s.lport === R.packet.dport; });
    return hasL ? "1 : " + conns : "0 : 0";
  }
  function selectedSocket() {
    if (selectedId === "new") return R.newSocket;
    var hit = sockRows[selectedId];
    return hit ? hit.sock : null;
  }
  function refreshSocketDetail() {
    var s = selectedSocket();
    setBytes("socket", s ? "fd " + s.fd : "—");
    setDetail("socket", socketDetail(s, R.packet));
  }
  function setDetail(key, html) { rowEls[key].querySelector(".lrow-detail-in").innerHTML = html; }
  function setBytes(key, txt) { rowEls[key].querySelector(".lrow-bytes").textContent = txt; }

  function selectSocket(id) {
    selectedId = id;
    refreshSocketDetail();
    STACK.forEach(function (r) { setRowOpen(r.key, r.key === "socket"); });  // reveal the endpoint you picked
    render();
  }

  /* ---------- narrowing + narration ---------- */
  function rowClassFor(sock) {
    var s = step, o = R.outcome;
    if (o === "drop") return s >= 2 ? "dimmed" : "";
    if (s <= 2) return "";
    if (!R.bucketIds[sock.id]) return "dimmed";
    if (s === 3) return "candidate";
    if (sock.id === R.matchId) {
      if (o === "accept") return s >= 5 ? "candidate" : "match will-accept";
      return "match";
    }
    return "dimmed";
  }
  function paintTable() {
    R.table.forEach(function (sock) {
      var entry = sockRows[sock.id], el = entry.el;
      var cls = rowClassFor(sock);
      el.className = "srow st-" + sock.state + (cls ? " " + cls : "") + (sock.id === selectedId ? " selected" : "");
      var deliverHot = R.outcome === "deliver" && sock.id === R.matchId && step >= 5;
      var rq = el.querySelector(".recvq");
      rq.textContent = deliverHot ? sock.recvq + R.packet.bytes : sock.recvq;
      rq.classList.toggle("hot", deliverHot);
    });
    // the socket minted by an accepted SYN appears only once it's created —
    // slotted next to its siblings so the shared-port family stays together
    if (R.newSocket) {
      var show = R.outcome === "accept" && step >= 5;
      if (show) {
        var justAdded = !newRowEl.parentNode;
        if (justAdded) {
          var anchor = null;
          R.table.forEach(function (s) { if (s.lport === R.packet.dport) anchor = sockRows[s.id].el; });
          if (anchor) anchor.after(newRowEl); else tableBody.appendChild(newRowEl);
          if (newRowEl.scrollIntoView) newRowEl.scrollIntoView({ block: "nearest" });
        }
        newRowEl.className = "srow st-ESTAB match" + (selectedId === "new" ? " selected" : "") + (justAdded ? " fresh" : "");
      } else if (newRowEl.parentNode) { tableBody.removeChild(newRowEl); }
    }
  }

  function statHTML() {
    var s = step, o = R.outcome, p = R.packet, PROTO = p.proto.toUpperCase();
    var bucket = R.table.filter(function (x) { return R.bucketIds[x.id]; });
    if (s === 0) return { html: "A packet on the wire. It carries a destination port — but a port is just a <b>number</b>, not a place to put data." };
    if (s === 1) return { html: "The link layer accepts the frame for this NIC. Nothing socket-specific has happened yet." };
    if (s === 2) {
      if (o === "drop") return { reject: true, html: "Destination IP <b>" + esc(p.dip) + "</b> isn't this host — the packet is dropped. The port never even mattered." };
      return { html: "Destination IP <b>" + esc(p.dip) + "</b> is this host. Protocol: <b>" + PROTO + "</b>. Now hand it up to " + PROTO + "." };
    }
    if (s === 3) {
      if (bucket.length === 0) return { reject: true, html: "Nothing is bound to <b>" + PROTO + ":" + esc(p.dport) + "</b> — there's no socket to look up." };
      return { html: "<b>" + bucket.length + "</b> socket" + (bucket.length === 1 ? "" : "s") + " share <b>" + PROTO + ":" + esc(p.dport) + "</b>. The port got us to the bucket — not to a connection." };
    }
    if (s === 4) {
      if (o === "drop") return { reject: true, html: "Already dropped — this packet was never for us." };
      if (o === "deliver" && p.proto === "tcp") return { html: "Best match: the established socket for <b>" + esc(p.sip + ":" + p.sport) + "</b>. Same :" + esc(p.dport) + " — but the full 5-tuple picks <b>this connection's own socket</b>." };
      if (o === "deliver") return { html: "UDP is connectionless: the single socket on :" + esc(p.dport) + " takes datagrams from <b>every</b> peer." };
      if (o === "accept") return { html: "No established socket yet — this SYN matches the <b>LISTEN</b> socket. The kernel will mint a brand-new socket for it." };
      return { reject: true, html: "No socket owns this 5-tuple. The kernel replies " + (p.proto === "tcp" ? "<b>RST</b>" : "<b>ICMP port unreachable</b>") + " — an “open port” with no socket doesn't exist." };
    }
    if (s === 5) {
      if (o === "deliver") { var m = R.table.filter(function (x) { return x.id === R.matchId; })[0]; return { html: "<b>" + p.bytes + " B</b> copied into fd <b>" + m.fd + "</b>'s receive buffer (Recv-Q → " + (m.recvq + p.bytes) + "). <b>This</b> is the endpoint that holds the data." }; }
      if (o === "accept") return { html: "New socket <b>fd " + R.newSocket.fd + "</b> created — same local :" + esc(p.dport) + ", peer <b>" + esc(peerOf(R.newSocket)) + "</b>. The listener stays free for the next client." };
      return { reject: true, html: "No buffer to fill — there was no socket. The rejection goes back to <b>" + esc(p.sip) + "</b>." };
    }
    // s === 6
    if (o === "deliver" || o === "accept") { var d = R.deliverId === "new" ? R.newSocket : R.table.filter(function (x) { return x.id === R.deliverId; })[0]; return { html: "<b>" + esc(d.proc) + "</b> wakes from " + (o === "accept" ? "accept()" : "recv()") + " and reads fd <b>" + d.fd + "</b>. The socket delivered the bytes; the port only pointed the way." }; }
    return { reject: true, html: "No process is woken. The port number existed; the endpoint never did." };
  }

  var COLOR_FOR = { port: "--c-port", tuple: "--c-tuple", socket: "--c-socket", listen: "--c-listen" };
  function activeColorVar() {
    if (R.outcome === "reset" || R.outcome === "unreach" || R.outcome === "drop") {
      if ((R.outcome === "drop" && step >= 2) || step >= 4) return "--c-reject";
    }
    var ent = SPOTLIGHT[step];
    return ent ? COLOR_FOR[ent] : "--accent";
  }
  var TAGWORD = ["on the wire", "link layer", "network", "port lookup", "demultiplex", "deliver", "delivered"];
  function tagWord() {
    var s = step, o = R.outcome;
    if (o === "drop") return s >= 2 ? "dropped" : TAGWORD[s];
    if (s === 4) return o === "accept" ? "accept" : (o === "deliver" ? "demultiplex" : "no socket");
    if (s === 5) return o === "accept" ? "new socket" : (o === "deliver" ? "deliver" : "rejected");
    if (s === 6) return (o === "deliver" || o === "accept") ? "delivered" : "no process";
    if (s === 3 && Object.keys(R.bucketIds).length === 0) return "no port";
    return TAGWORD[s];
  }

  function render() {
    var node = NODES[step], colorVar = activeColorVar();

    // endpoints
    epWire.classList.toggle("active", step <= 1);
    epProc.classList.toggle("active", step === 6 && (R.outcome === "deliver" || R.outcome === "accept"));

    // phase
    phaseTag.textContent = tagWord();
    phaseTag.style.color = "var(" + colorVar + ")";
    phaseNode.innerHTML = node.icon + " <b>" + esc(node.name) + '</b> <span class="ps">' + esc(node.sub) + "</span>";

    // rail
    railDots.forEach(function (dot, i) {
      var cur = i === step;
      dot.classList.toggle("current", cur);
      dot.classList.toggle("done", i < step);
      dot.setAttribute("aria-current", cur ? "step" : "false");
      dot.setAttribute("r", cur ? "6.5" : "4.5");
      dot.style.fill = cur ? "var(" + colorVar + ")" : "";
      dot.style.color = cur ? "var(" + colorVar + ")" : "";   // drives the halo
    });

    // tuple chips
    var lit = litChips(step);
    Array.prototype.forEach.call(tupleChips.children, function (chip, i) { chip.classList.toggle("lit", !!lit[CHIPS[i].key]); });

    // socket table + stat
    paintTable();
    var st = statHTML();
    tableStat.innerHTML = st.html;
    tableStat.classList.toggle("reject", !!st.reject);

    // spotlight the active anatomy row
    var ent = SPOTLIGHT[step];
    STACK.forEach(function (r) { rowEls[r.key].classList.toggle("spotlight", r.key === ent); });

    $("prev").disabled = step === 0;
    $("next").disabled = step === MAXSTEP;
  }

  /* ---------- expand / collapse an anatomy row ---------- */
  function setRowOpen(key, open) {
    rowEls[key].classList.toggle("open", open);
    rowEls[key].querySelector(".lrow-head").setAttribute("aria-expanded", open ? "true" : "false");
  }
  function toggleRow(key) {
    var willOpen = !rowEls[key].classList.contains("open");
    if (willOpen) STACK.forEach(function (r) { if (r.key !== key) setRowOpen(r.key, false); });
    setRowOpen(key, willOpen);
  }

  /* ---------- navigation ---------- */
  function goTo(s) { stopPlay(); step = clamp(s, 0, MAXSTEP); render(); }
  function stepBy(d) { goTo(step + d); }
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; $("replay").classList.remove("playing"); } }
  function replay() {
    stopPlay(); step = 0; render();
    $("replay").classList.add("playing");
    playTimer = setInterval(function () { if (step >= MAXSTEP) { stopPlay(); return; } step += 1; render(); }, 850);
  }
  function setPacket(packet) {
    stopPlay();
    R = resolve(packet);
    selectedId = R.deliverId;
    step = 0;
    applyPacket();
    render();
  }

  railDots.forEach(function (dot) {
    var s = parseInt(dot.dataset.step, 10), node = NODES[s];
    dot.setAttribute("tabindex", "0");
    dot.setAttribute("role", "button");
    dot.setAttribute("aria-label", "Go to step " + (s + 1) + ": " + node.name + ", " + node.sub);
    dot.addEventListener("click", function () { goTo(s); });
    dot.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goTo(s); } });
  });
  $("prev").addEventListener("click", function () { stepBy(-1); });
  $("next").addEventListener("click", function () { stepBy(1); });
  $("replay").addEventListener("click", replay);
  $("new-req").addEventListener("click", function () { setPacket(pick(CATALOG)()); });

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
    if (e.key === "ArrowRight") { e.preventDefault(); stepBy(1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); stepBy(-1); }
    else if (e.key === "Home") { e.preventDefault(); goTo(0); }
    else if (e.key === "End") { e.preventDefault(); goTo(MAXSTEP); }
  });

  /* ---------- init ---------- */
  applyPacket();
  render();
  openHelp(true);
})();
