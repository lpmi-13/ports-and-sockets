import "./styles.css";

const SERVER = "192.168.1.10";
const LOCAL_PORT = 80;
const NGINX_PID = 1234;
const CONNECTION_CAP = 5;

interface BaseEntity {
  id: string;
  lport: number;
  fd: number;
  inode: number;
  fresh?: boolean;
}

interface ListeningEntity extends BaseEntity {
  kind: "listen";
  pip: null;
  pport: null;
  tcp: "LISTEN";
}

interface ConnectionEntity extends BaseEntity {
  kind: "conn";
  pip: string;
  pport: number;
  tcp: "ESTAB";
}

type Entity = ListeningEntity | ConnectionEntity;

interface FlashMessage {
  html: string;
  reject?: boolean;
}

interface GetSocketNameResult {
  fd: number;
  lport: number;
}

interface AppState {
  entities: Entity[];
  selected: string;
  fdNext: number;
  inodeNext: number;
  getsockname: GetSocketNameResult | null;
  flash: FlashMessage | null;
}

type CardKey = "port" | "fd" | "socket";

interface Card {
  key: CardKey;
  name: string;
  kind: string;
  color: string;
  caption: string;
  detail: string;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) {
    throw new Error(`Missing required element #${id}`);
  }

  return found as T;
}

function query<T extends Element>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);

  if (!found) {
    throw new Error(`Missing required element ${selector}`);
  }

  return found;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: unknown): string {
  return String(value).replace(
    /[&<>"']/g,
    (character) => HTML_ESCAPES[character] ?? character,
  );
}

function randomInteger(minimum: number, maximum: number): number {
  return minimum + Math.floor(Math.random() * (maximum - minimum + 1));
}

function terminal(command: string, output: string): string {
  return `<div class="term"><div class="term-cmd">${escapeHtml(`$ ${command}`)}</div><pre class="term-out">${escapeHtml(output)}</pre></div>`;
}

function note(html: string): string {
  return `<div class="ld-fields"><div class="ld-field">${html}</div></div>`;
}

function chip(colorVariable: string, label: string): string {
  return `<span class="tchip lit" style="--tc: var(${colorVariable})">${escapeHtml(label)}</span>`;
}

const state: AppState = {
  entities: [],
  selected: "c0",
  fdNext: 5,
  inodeNext: 12347,
  getsockname: null,
  flash: null,
};

let connectionId = 1;

function reset(): void {
  state.entities = [
    {
      id: "listen",
      kind: "listen",
      lport: LOCAL_PORT,
      pip: null,
      pport: null,
      fd: 3,
      inode: 11001,
      tcp: "LISTEN",
    },
    {
      id: "c0",
      kind: "conn",
      lport: LOCAL_PORT,
      pip: "10.0.0.55",
      pport: 54321,
      fd: 4,
      inode: 12346,
      tcp: "ESTAB",
    },
  ];
  state.selected = "c0";
  state.fdNext = 5;
  state.inodeNext = 12347;
  state.getsockname = null;
  state.flash = {
    html: "One TCP connection, named three ways. Click a row in any lens — the same connection lights up in all three.",
  };
  connectionId = 1;
}

function connections(): ConnectionEntity[] {
  return state.entities.filter(
    (entity): entity is ConnectionEntity => entity.kind === "conn",
  );
}

function entityById(id: string): Entity | undefined {
  return state.entities.find((entity) => entity.id === id);
}

function acceptConnection(): void {
  if (connections().length >= CONNECTION_CAP) {
    state.flash = {
      html: "Keeping it to a handful for the demo — the point holds at any N: every connection is one more socket, one more fd, still port :80 on the wire.",
    };
    return;
  }

  const entity: ConnectionEntity = {
    id: `c${connectionId++}`,
    kind: "conn",
    lport: LOCAL_PORT,
    pip: `10.0.0.${randomInteger(20, 250)}`,
    pport: randomInteger(49152, 65535),
    fd: state.fdNext++,
    inode: state.inodeNext++,
    tcp: "ESTAB",
    fresh: true,
  };

  state.entities.push(entity);
  state.selected = entity.id;
  state.getsockname = null;
  state.flash = {
    html: `<code>accept()</code> returned <b>fd ${entity.fd}</b>. The connection now exists in all three lenses at once — a flow on the wire, <code>socket:[${entity.inode}]</code> in the kernel, fd ${entity.fd} in nginx.`,
  };
}

function closeConnection(): void {
  const activeConnections = connections();
  const lastConnection = activeConnections.at(-1);

  if (!lastConnection) {
    state.flash = {
      reject: true,
      html: "No client connections to close — only the listening socket is left.",
    };
    return;
  }

  state.entities = state.entities.filter(
    (entity) => entity.id !== lastConnection.id,
  );
  state.selected = connections().at(-1)?.id ?? "listen";
  state.getsockname = null;
  state.flash = {
    html: `<code>close(fd ${lastConnection.fd})</code> — the fd is released and the kernel tears the socket down. Port :80 is untouched; it was never this connection's to hold.`,
  };
}

function getSocketName(): void {
  const selectedEntity = entityById(state.selected);

  if (!selectedEntity) {
    return;
  }

  state.getsockname = {
    fd: selectedEntity.fd,
    lport: selectedEntity.lport,
  };
  state.flash = {
    html: `nginx held only <b>fd ${selectedEntity.fd}</b>. To name its own port it had to <b>ask the kernel</b> — <code>getsockname()</code> is a syscall; the port isn't in user space.`,
  };
}

function wireRow(entity: Entity): string {
  if (entity.kind === "listen") {
    return `<span class="tok-muted">${SERVER}:</span><span class="tok-port">${entity.lport}</span><span class="tok-muted"> — clients dial this address</span>`;
  }

  return (
    `<span class="tok-muted">${SERVER}:</span><span class="tok-port">${entity.lport}</span>` +
    '<span class="tok-muted"> → </span>' +
    `<span class="tok-muted">${entity.pip}:</span><span class="tok-port">${entity.pport}</span>`
  );
}

function kernelRow(entity: Entity): string {
  const addresses =
    entity.kind === "listen"
      ? `0.0.0.0:${entity.lport}`
      : `${SERVER}:${entity.lport} ${entity.pip}:${entity.pport}`;

  return (
    `<span class="tok-state">${entity.tcp}</span> ` +
    `<span class="tok-muted">${escapeHtml(addresses)}</span> ` +
    `<span class="tok-sock">socket:[${entity.inode}]</span>`
  );
}

function processRow(entity: Entity): string {
  const action =
    entity.kind === "listen"
      ? '<span class="tok-muted"> (LISTEN)</span>'
      : `<span class="tok-muted"> read(${entity.fd})/write(${entity.fd})</span>`;

  return (
    `<span class="tok-fd">fd ${entity.fd}</span>` +
    '<span class="tok-muted"> → </span>' +
    `<span class="tok-sock">socket:[${entity.inode}]</span>` +
    action
  );
}

const wireBody = element("wire-body");
const kernelBody = element("kernel-body");
const processBody = element("proc-body");
const ticket = element("req-label");
const names = element("names");
const status = element("status");
const topLink = element("link-top");
const bottomLink = element("link-bot");
const getSocketNameOutput = element("gsn");
const closeButton = element<HTMLButtonElement>("close");

function fillLens(
  body: HTMLElement,
  rowContent: (entity: Entity) => string,
): void {
  body.replaceChildren();

  state.entities.forEach((entity) => {
    const row = document.createElement("div");
    row.className =
      "lens-row" +
      (entity.id === state.selected ? " sel" : "") +
      (entity.fresh ? " fresh" : "");
    row.setAttribute("role", "button");
    row.tabIndex = 0;
    row.setAttribute(
      "aria-label",
      `Select the ${
        entity.kind === "listen"
          ? "listening socket"
          : `connection to ${entity.pip}:${entity.pport}`
      }`,
    );
    row.innerHTML = rowContent(entity);
    row.addEventListener("click", () => selectEntity(entity.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectEntity(entity.id);
      }
    });
    body.appendChild(row);
  });
}

function selectEntity(id: string): void {
  state.selected = id;
  state.getsockname = null;
  render();
}

function render(): void {
  const activeConnections = connections();
  const connectionCount = activeConnections.length;
  const selectedEntity = entityById(state.selected) ?? state.entities[0];

  if (!selectedEntity) {
    throw new Error("The connection model must contain at least one entity");
  }

  ticket.innerHTML =
    '<span class="req-method">nginx</span>' +
    `<span class="req-path">listening on :<b>${LOCAL_PORT}</b></span>` +
    `<span class="req-body">${connectionCount} connection${connectionCount === 1 ? "" : "s"}</span>`;

  const portLabel =
    selectedEntity.kind === "listen"
      ? `:${selectedEntity.lport}`
      : `:${selectedEntity.lport} ↔ :${selectedEntity.pport}`;

  names.innerHTML =
    chip("--c-port", `port ${portLabel}`) +
    chip("--c-socket", `socket:[${selectedEntity.inode}]`) +
    chip("--c-tuple", `fd ${selectedEntity.fd}`);

  fillLens(wireBody, wireRow);
  fillLens(kernelBody, kernelRow);
  fillLens(processBody, processRow);
  state.entities.forEach((entity) => {
    entity.fresh = false;
  });

  query<HTMLElement>(topLink, ".link-label").innerHTML =
    `port ↓ · kernel demuxes the packet by (src, sport, dst, dport, proto) into <b>socket:[${selectedEntity.inode}]</b>`;
  query<HTMLElement>(bottomLink, ".link-label").innerHTML =
    `fd ↑ · nginx <b>fd ${selectedEntity.fd}</b> → <b>socket:[${selectedEntity.inode}]</b>`;
  topLink.classList.add("hot");
  bottomLink.classList.add("hot");

  if (state.getsockname) {
    getSocketNameOutput.hidden = false;
    getSocketNameOutput.innerHTML = terminal(
      `strace -p ${NGINX_PID} -e trace=getsockname`,
      `getsockname(${state.getsockname.fd}, {sa_family=AF_INET, sin_port=htons(${state.getsockname.lport}), sin_addr=inet_addr("${SERVER}")}, [16]) = 0`,
    );
  } else {
    getSocketNameOutput.hidden = true;
    getSocketNameOutput.replaceChildren();
  }

  status.innerHTML = state.flash?.html ?? "";
  status.classList.toggle("reject", Boolean(state.flash?.reject));
  closeButton.disabled = connectionCount === 0;
}

const CARDS: readonly Card[] = [
  {
    key: "port",
    name: "The port is routing, not a handle",
    kind: "on the wire",
    color: "--c-port",
    caption:
      "A port names the endpoint on the wire, so the remote host — and the kernel's demux — can find the socket. Once <code>accept()</code> returns, the port is gone from user space.",
    detail:
      terminal(
        "tcpdump -ni any 'tcp port 80'",
        "192.168.1.10.80 > 10.0.0.55.54321: Flags [P.], seq 1:43, length 42\n" +
          "10.0.0.55.54321 > 192.168.1.10.80: Flags [.], ack 43, length 0",
      ) +
      note(
        "On the wire a connection <i>is</i> its ports and IPs — that's routing information the kernel matches against, not a token the process carries around.",
      ),
  },
  {
    key: "fd",
    name: "The fd is the process's token",
    kind: "in user space",
    color: "--c-tuple",
    caption:
      "nginx <code>read()</code>/<code>write()</code>s <b>fd 4</b> and never names :80 again. The port isn't in its address space; to recover it the process must <code>getsockname()</code> — a syscall.",
    detail:
      terminal(
        "lsof -p 1234",
        "COMMAND  PID     USER  FD  TYPE DEVICE NODE NAME\n" +
          "nginx   1234 www-data   3u IPv4  11001  TCP *:80 (LISTEN)\n" +
          "nginx   1234 www-data   4u IPv4  12346  TCP 192.168.1.10:80->10.0.0.55:54321 (ESTABLISHED)",
      ) +
      note(
        "The <code>*:80</code> text is reconstructed by lsof from <code>/proc/1234/fd/4</code> → the kernel socket. The fd table itself just holds “fd 4 → socket object”.",
      ),
  },
  {
    key: "socket",
    name: "The socket is the shared object",
    kind: "in the kernel",
    color: "--c-socket",
    caption:
      "The kernel socket — buffers, TCP state, the 5-tuple — is the reality both sides point at. <code>socket:[12346]</code> is the join: the port routes packets <b>into</b> it, the fd reads <b>out</b> of it.",
    detail:
      terminal(
        "ss -tenp",
        'ESTAB 0 0 192.168.1.10:80 10.0.0.55:54321\n      ino:12346 sk:2 <-> users:(("nginx",pid=1234,fd=4))',
      ) +
      note(
        "One object, two names: the wire calls it <code>:80 ↔ :54321</code>, the process calls it <code>fd 4</code>. Change the port and packets miss it; close the fd and the process loses its grip — but it's the same socket in the middle.",
      ),
  },
];

const stack = element("stack");
const cardElements = new Map<CardKey, HTMLDivElement>();

function cardElement(key: CardKey): HTMLDivElement {
  const card = cardElements.get(key);

  if (!card) {
    throw new Error(`Missing card ${key}`);
  }

  return card;
}

function buildCards(): void {
  stack.replaceChildren();
  cardElements.clear();

  CARDS.forEach((card) => {
    const cardRoot = document.createElement("div");
    cardRoot.className = "lrow";
    cardRoot.style.setProperty("--c", `var(${card.color})`);
    cardRoot.innerHTML =
      '<div class="lrow-card">' +
      '<button class="lrow-head" aria-expanded="false">' +
      '<span class="lrow-sw"></span>' +
      '<span class="lrow-main">' +
      `<span class="lrow-name">${escapeHtml(card.name)} <b class="lkind">${escapeHtml(card.kind)}</b></span>` +
      `<span class="lrow-cap">${card.caption}</span>` +
      "</span>" +
      '<span class="lrow-chev" aria-hidden="true">▸</span>' +
      "</button>" +
      `<div class="lrow-detail"><div class="lrow-detail-in">${card.detail}</div></div>` +
      "</div>";

    stack.appendChild(cardRoot);
    cardElements.set(card.key, cardRoot);
    query<HTMLButtonElement>(cardRoot, ".lrow-head").addEventListener(
      "click",
      () => toggleCard(card.key),
    );
  });
}

function setCardOpen(key: CardKey, open: boolean): void {
  const card = cardElement(key);
  card.classList.toggle("open", open);
  query<HTMLButtonElement>(card, ".lrow-head").setAttribute(
    "aria-expanded",
    String(open),
  );
}

function toggleCard(key: CardKey): void {
  const willOpen = !cardElement(key).classList.contains("open");

  CARDS.forEach((card) => {
    if (card.key !== key) {
      setCardOpen(card.key, false);
    }
  });
  setCardOpen(key, willOpen);
}

element<HTMLButtonElement>("accept").addEventListener("click", () => {
  acceptConnection();
  render();
});
closeButton.addEventListener("click", () => {
  closeConnection();
  render();
});
element<HTMLButtonElement>("reset").addEventListener("click", () => {
  reset();
  render();
});
element<HTMLButtonElement>("gsn-btn").addEventListener("click", () => {
  getSocketName();
  render();
});

const help = element("help");
const helpStart = element<HTMLButtonElement>("help-start");
const helpCard = query<HTMLElement>(help, ".sheet-card");
const stage = element("stage");
let returnFocusTo: HTMLElement | null = null;

function openHelp(firstRun: boolean): void {
  returnFocusTo =
    document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  helpStart.hidden = !firstRun;
  help.hidden = false;
  (firstRun ? helpStart : element<HTMLButtonElement>("help-close")).focus();
}

function closeHelp(): void {
  help.hidden = true;

  if (returnFocusTo) {
    returnFocusTo.focus();
  } else {
    stage.focus();
  }
}

function keepFocusInHelp(event: KeyboardEvent): void {
  if (event.key !== "Tab" || help.hidden) {
    return;
  }

  const focusable = Array.from(
    helpCard.querySelectorAll<HTMLButtonElement>("button:not([hidden])"),
  );
  const first = focusable[0];
  const last = focusable.at(-1);

  if (!first || !last) {
    return;
  }

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

element<HTMLButtonElement>("help-btn").addEventListener("click", () =>
  openHelp(false),
);
element<HTMLButtonElement>("help-close").addEventListener("click", closeHelp);
helpStart.addEventListener("click", closeHelp);

document.addEventListener("keydown", (event) => {
  if (!help.hidden) {
    if (event.key === "Escape") {
      closeHelp();
    } else {
      keepFocusInHelp(event);
    }
    return;
  }

  const activeTag = document.activeElement?.tagName ?? "";
  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(activeTag)) {
    return;
  }

  if (event.key === "a" || event.key === "A") {
    acceptConnection();
    render();
  } else if (event.key === "x" || event.key === "X") {
    closeConnection();
    render();
  }
});

reset();
buildCards();
render();
openHelp(true);
