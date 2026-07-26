import "./styles.css";

const SERVER = "192.168.1.10";
const LOCAL_PORT = 80;
const NGINX_PID = 1234;
const EXPANSION_TRANSITION_MS = 560;

interface Connection {
  id: string;
  remoteIp: string;
  remotePort: number;
  fd: number;
  inode: number;
  state: "ESTAB";
  fresh?: boolean;
}

interface AppState {
  connections: Connection[];
  selected: string | null;
  expanded: string | null;
  fdNext: number;
  inodeNext: number;
}

function element<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);

  if (!found) {
    throw new Error(`Missing required element #${id}`);
  }

  return found as T;
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

const state: AppState = {
  connections: [],
  selected: "c0",
  expanded: null,
  fdNext: 5,
  inodeNext: 12347,
};

let connectionId = 1;
let revealSelectedAfterRender = false;
let pendingAcceptTimer: number | null = null;

function reset(): void {
  state.connections = [
    {
      id: "c0",
      remoteIp: "203.0.113.55",
      remotePort: 54321,
      fd: 4,
      inode: 12346,
      state: "ESTAB",
    },
  ];
  state.selected = "c0";
  state.expanded = null;
  state.fdNext = 5;
  state.inodeNext = 12347;
  connectionId = 1;
  revealSelectedAfterRender = false;
}

function nextRemoteIp(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `203.0.113.${randomInteger(20, 250)}`;

    if (
      !state.connections.some(
        (connection) => connection.remoteIp === candidate,
      )
    ) {
      return candidate;
    }
  }

  return `203.0.113.${randomInteger(20, 250)}`;
}

function acceptConnection(): void {
  const connection: Connection = {
    id: `c${connectionId++}`,
    remoteIp: nextRemoteIp(),
    remotePort: randomInteger(49152, 65535),
    fd: state.fdNext++,
    inode: state.inodeNext++,
    state: "ESTAB",
    fresh: true,
  };

  state.connections.push(connection);
  state.selected = connection.id;
  revealSelectedAfterRender = true;
}

function closeSelectedConnection(): void {
  if (state.connections.length === 0) {
    return;
  }

  const selectedIndex = state.connections.findIndex(
    (connection) => connection.id === state.selected,
  );
  const targetIndex =
    selectedIndex >= 0 ? selectedIndex : state.connections.length - 1;
  const target = state.connections[targetIndex];

  if (!target) {
    return;
  }

  const removedExpandedConnection = state.expanded === target.id;
  state.connections = state.connections.filter(
    (connection) => connection.id !== target.id,
  );

  const nextSelection =
    state.connections[targetIndex] ?? state.connections[targetIndex - 1];
  state.selected = nextSelection?.id ?? null;
  if (removedExpandedConnection) {
    state.expanded = null;
  }
  revealSelectedAfterRender = Boolean(nextSelection);
}

function tupleField(label: string, value: string, kind = ""): string {
  return (
    `<div class="tuple-field ${escapeHtml(kind)}">` +
    `<span>${escapeHtml(label)}</span>` +
    `<strong>${escapeHtml(value)}</strong>` +
    "</div>"
  );
}

function chainNode(label: string, value: string, kind = ""): string {
  return (
    `<div class="chain-node ${escapeHtml(kind)}">` +
    `<span>${escapeHtml(label)}</span>` +
    `<strong>${escapeHtml(value)}</strong>` +
    "</div>"
  );
}

function endpointNode(
  label: string,
  address: string,
  port: number,
  kind: string,
): string {
  return (
    `<div class="endpoint-node ${escapeHtml(kind)}">` +
    `<span>${escapeHtml(label)}</span>` +
    `<strong>${escapeHtml(address)}:<b>${port}</b></strong>` +
    "</div>"
  );
}

function portReference(connection: Connection): string {
  return (
    '<section class="reference-card port-reference" aria-label="Remote port reference">' +
    '<header><span>Remote</span><strong>Port</strong></header>' +
    "<h2>Addressed on the wire</h2>" +
    '<p>The client reaches nginx using the two endpoint addresses. The port is part of the connection identity carried by every packet.</p>' +
    '<div class="endpoint-pair">' +
    endpointNode(
      "Source endpoint",
      connection.remoteIp,
      connection.remotePort,
      "remote",
    ) +
    '<span class="endpoint-arrow" aria-hidden="true">→</span>' +
    endpointNode(
      "Destination endpoint",
      SERVER,
      LOCAL_PORT,
      "destination",
    ) +
    "</div>" +
    "</section>"
  );
}

function socketReference(connection: Connection): string {
  return (
    '<section class="reference-card socket-reference" aria-label="Kernel socket reference">' +
    '<header><span>Kernel</span><strong>Socket</strong></header>' +
    `<div class="reference-title-line"><h2>socket:[${connection.inode}]</h2><span class="state-badge">${connection.state}</span></div>` +
    '<p>The kernel matches an incoming packet to this socket using all five fields together.</p>' +
    '<div class="tuple-grid" aria-label="Incoming TCP packet five-tuple">' +
    tupleField("Source address", connection.remoteIp, "address source") +
    tupleField("Source port", String(connection.remotePort), "port source") +
    tupleField("Destination address", SERVER, "address destination") +
    tupleField("Destination port", String(LOCAL_PORT), "port destination") +
    tupleField("Protocol", "TCP", "protocol") +
    "</div>" +
    "</section>"
  );
}

function fdReference(connection: Connection): string {
  const operations = [
    `read(${connection.fd})`,
    `write(${connection.fd})`,
    `close(${connection.fd})`,
  ];

  return (
    '<section class="reference-card fd-reference" aria-label="nginx file descriptor reference">' +
    '<header><span>nginx</span><strong>File descriptor</strong></header>' +
    `<h2>fd ${connection.fd}</h2>` +
    '<p>The integer indexes nginx’s process-local FD table, which reaches the kernel socket through an open file description.</p>' +
    '<div class="fd-chain" aria-label="File descriptor reference chain">' +
    chainNode("Process", `nginx · ${NGINX_PID}`, "process") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("FD table slot", `[${connection.fd}]`, "descriptor") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("Open file description", "struct file", "file") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("Kernel object", `socket:[${connection.inode}]`, "socket") +
    "</div>" +
    '<div class="fd-operations" aria-label="Operations using this file descriptor">' +
    operations
      .map((operation) => `<code>${escapeHtml(operation)}</code>`)
      .join("") +
    "</div>" +
    "</section>"
  );
}

function connectionDetails(connection: Connection): string {
  return (
    `<div class="reference-scroller" tabindex="0" aria-label="Port, socket, and file descriptor references for the connection from ${escapeHtml(connection.remoteIp)}:${connection.remotePort}">` +
    '<div class="reference-track">' +
    portReference(connection) +
    '<span class="reference-arrow" aria-hidden="true">→</span>' +
    socketReference(connection) +
    '<span class="reference-arrow" aria-hidden="true">→</span>' +
    fdReference(connection) +
    "</div>" +
    "</div>"
  );
}

function bindReferenceScroller(article: HTMLElement): void {
  const scroller =
    article.querySelector<HTMLElement>(".reference-scroller");

  if (!scroller || scroller.dataset.bound === "true") {
    return;
  }

  scroller.dataset.bound = "true";
  scroller.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      scroller.scrollBy({
        left: event.key === "ArrowRight" ? 360 : -360,
        behavior: "smooth",
      });
    }
  });
}

function ensureConnectionDetails(
  article: HTMLElement,
  connection: Connection,
): void {
  const detailsInner = article.querySelector<HTMLElement>(
    ".connection-details-inner",
  );

  if (!detailsInner || detailsInner.childElementCount > 0) {
    return;
  }

  detailsInner.innerHTML = connectionDetails(connection);
  bindReferenceScroller(article);
}

function setArticleExpanded(
  article: HTMLElement,
  connection: Connection,
  expanded: boolean,
): void {
  const summary =
    article.querySelector<HTMLButtonElement>(".connection-summary");
  const details =
    article.querySelector<HTMLElement>(".connection-details");

  if (!summary || !details) {
    return;
  }

  summary.setAttribute("aria-expanded", String(expanded));
  details.setAttribute("aria-hidden", String(!expanded));
  details.inert = !expanded;

  if (expanded) {
    ensureConnectionDetails(article, connection);
    void details.offsetHeight;
    article.classList.add("expanded");
  } else {
    article.classList.remove("expanded");
  }
}

function markSelectedConnection(id: string): void {
  connectionList
    .querySelectorAll<HTMLElement>(".connection-card")
    .forEach((card) => {
      card.classList.toggle("selected", card.dataset.connectionId === id);
    });
}

function toggleConnection(id: string): void {
  const connection = state.connections.find((item) => item.id === id);
  const article = connectionList.querySelector<HTMLElement>(
    `[data-connection-id="${id}"]`,
  );

  if (!connection || !article) {
    return;
  }

  const previousExpandedId = state.expanded;
  const willExpand = previousExpandedId !== id;
  state.selected = id;
  state.expanded = willExpand ? id : null;
  markSelectedConnection(id);

  if (previousExpandedId && previousExpandedId !== id) {
    const previousConnection = state.connections.find(
      (item) => item.id === previousExpandedId,
    );
    const previousArticle = connectionList.querySelector<HTMLElement>(
      `[data-connection-id="${previousExpandedId}"]`,
    );

    if (previousConnection && previousArticle) {
      setArticleExpanded(previousArticle, previousConnection, false);
    }
  }

  setArticleExpanded(article, connection, willExpand);

  if (willExpand) {
    window.setTimeout(
      () => article.scrollIntoView({ block: "nearest" }),
      180,
    );
  }
}

function collapseExpandedConnection(): void {
  const expandedId = state.expanded;

  if (!expandedId) {
    return;
  }

  const connection = state.connections.find(
    (item) => item.id === expandedId,
  );
  const article = connectionList.querySelector<HTMLElement>(
    `[data-connection-id="${expandedId}"]`,
  );

  state.expanded = null;

  if (connection && article) {
    setArticleExpanded(article, connection, false);
  }
}

function connectionCard(connection: Connection): HTMLElement {
  const expanded = connection.id === state.expanded;
  const selected = connection.id === state.selected;
  const article = document.createElement("article");
  article.className =
    "connection-card" +
    (selected ? " selected" : "") +
    (expanded ? " expanded" : "") +
    (connection.fresh ? " fresh" : "");
  article.dataset.connectionId = connection.id;
  article.setAttribute("role", "listitem");

  const detailsId = `connection-details-${connection.id}`;
  article.innerHTML =
    `<button class="connection-summary" type="button" aria-expanded="${expanded}" aria-controls="${detailsId}">` +
    '<span class="lane-endpoint lane-remote">' +
    '<span>Remote host</span>' +
    `<strong>${escapeHtml(connection.remoteIp)}:<b>${connection.remotePort}</b></strong>` +
    "</span>" +
    '<span class="connection-thread" aria-hidden="true">' +
    `<span class="thread-state">${connection.state}</span>` +
    '<span class="thread-line"><i></i></span>' +
    "</span>" +
    '<span class="lane-endpoint lane-server">' +
    '<span>nginx</span>' +
    `<strong>${SERVER}:<b>${LOCAL_PORT}</b></strong>` +
    "</span>" +
    '<span class="connection-chevron" aria-hidden="true">›</span>' +
    "</button>" +
    `<div class="connection-details" id="${detailsId}" aria-hidden="${!expanded}">` +
    '<div class="connection-details-inner">' +
    (expanded ? connectionDetails(connection) : "") +
    "</div>" +
    "</div>";

  const details =
    article.querySelector<HTMLElement>(".connection-details");

  if (details) {
    details.inert = !expanded;
  }

  article
    .querySelector<HTMLButtonElement>(".connection-summary")
    ?.addEventListener("click", () => toggleConnection(connection.id));
  bindReferenceScroller(article);

  return article;
}

const ticket = element("req-label");
const connectionList = element("connection-list");
const serverCount = element("server-count");
const acceptButton = element<HTMLButtonElement>("accept");
const closeButton = element<HTMLButtonElement>("close");

function cancelPendingAccept(): void {
  if (pendingAcceptTimer === null) {
    return;
  }

  window.clearTimeout(pendingAcceptTimer);
  pendingAcceptTimer = null;
  acceptButton.disabled = false;
}

function addClientConnection(): void {
  if (pendingAcceptTimer !== null) {
    return;
  }

  if (!state.expanded) {
    acceptConnection();
    render();
    return;
  }

  collapseExpandedConnection();
  acceptButton.disabled = true;

  const transitionDelay = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches
    ? 0
    : EXPANSION_TRANSITION_MS;

  pendingAcceptTimer = window.setTimeout(() => {
    pendingAcceptTimer = null;
    acceptConnection();
    render();
    acceptButton.disabled = false;
  }, transitionDelay);
}

function render(): void {
  const connectionCount = state.connections.length;

  ticket.innerHTML =
    '<span class="req-method">nginx</span>' +
    `<span class="req-path">listening on :<b>${LOCAL_PORT}</b></span>`;
  serverCount.textContent =
    `${connectionCount} active connection${connectionCount === 1 ? "" : "s"}`;

  connectionList.replaceChildren();

  if (connectionCount === 0) {
    const emptyState = document.createElement("div");
    emptyState.className = "connections-empty";
    emptyState.innerHTML =
      '<span class="empty-line" aria-hidden="true"></span>' +
      "<h2>No active connections</h2>" +
      `<p>nginx is still listening on ${SERVER}:${LOCAL_PORT}.</p>`;
    connectionList.appendChild(emptyState);
  } else {
    state.connections.forEach((connection) => {
      connectionList.appendChild(connectionCard(connection));
    });
  }

  state.connections.forEach((connection) => {
    connection.fresh = false;
  });

  closeButton.disabled = connectionCount === 0;

  if (revealSelectedAfterRender && state.selected) {
    const selectedCard = connectionList.querySelector<HTMLElement>(
      `[data-connection-id="${state.selected}"]`,
    );
    requestAnimationFrame(() =>
      selectedCard?.scrollIntoView({ block: "nearest" }),
    );
  }

  revealSelectedAfterRender = false;
}

acceptButton.addEventListener("click", () => {
  addClientConnection();
});

closeButton.addEventListener("click", () => {
  cancelPendingAccept();
  closeSelectedConnection();
  render();
});

element<HTMLButtonElement>("reset").addEventListener("click", () => {
  cancelPendingAccept();
  reset();
  render();
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.expanded) {
    collapseExpandedConnection();
    return;
  }

  const activeTag = document.activeElement?.tagName ?? "";

  if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(activeTag)) {
    return;
  }

  if (event.key === "a" || event.key === "A") {
    addClientConnection();
  } else if (event.key === "x" || event.key === "X") {
    cancelPendingAccept();
    closeSelectedConnection();
    render();
  }
});

reset();
render();
