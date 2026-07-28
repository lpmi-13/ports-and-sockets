import "./styles.css";

const SERVER = "198.51.100.80";
const LOCAL_PORT = 80;
const NGINX_PID = 1234;
const EXPANSION_TRANSITION_MS = 560;
const CONNECTION_ENTRANCE_MS = 900;
const CONNECTION_SCROLL_DELAY_MS = 80;
const CONNECTION_SCROLL_DURATION_MS = 780;
const TOPOLOGY_LAYOUT_TRANSITION_MS = 560;
const TOPOLOGY_VISIBLE_CONNECTIONS = 3;

type Perspective = "client" | "server";

interface LocalReference {
  process: string;
  pid: number;
  fd: number;
  inode: number;
}

interface Connection {
  id: string;
  clientIp: string;
  clientPort: number;
  client: LocalReference;
  server: LocalReference;
  state: "ESTAB";
  fresh?: boolean;
}

interface AppState {
  connections: Connection[];
  selected: string | null;
  expanded: string | null;
  perspective: Perspective;
  serverFdNext: number;
  serverInodeNext: number;
  clientInodeNext: number;
  clientPidNext: number;
}

interface EndpointReference {
  side: Perspective;
  label: string;
  hostLabel: string;
  address: string;
  port: number;
  reference: LocalReference;
}

interface RenderOptions {
  animatePerspective?: boolean;
  referenceScrollLeft?: number;
}

interface TopologyConnectionItem {
  type: "connection";
  connection: Connection;
}

interface TopologyAggregateItem {
  type: "aggregate";
  count: number;
  selectedConnectionId: string | null;
  fresh: boolean;
}

type TopologyItem = TopologyConnectionItem | TopologyAggregateItem;

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
  perspective: "server",
  serverFdNext: 7,
  serverInodeNext: 12349,
  clientInodeNext: 88424,
  clientPidNext: 2713,
};

let connectionId = 1;
let pendingAcceptTimer: number | null = null;
let pendingConnectionRevealTimer: number | null = null;
let connectionScrollFrame: number | null = null;
let topologyLayoutFrame: number | null = null;
let topologyResizeFrame: number | null = null;
let noticeUpdateFrame: number | null = null;
let unseenConnectionIds: string[] = [];

function reset(): void {
  state.connections = [
    {
      id: "c0",
      clientIp: "203.0.113.55",
      clientPort: 54321,
      client: {
        process: "client-app",
        pid: 2710,
        fd: 7,
        inode: 88421,
      },
      server: {
        process: "nginx",
        pid: NGINX_PID,
        fd: 4,
        inode: 12346,
      },
      state: "ESTAB",
    },
    {
      id: "c1",
      clientIp: "203.0.113.92",
      clientPort: 61104,
      client: {
        process: "client-app",
        pid: 2711,
        fd: 7,
        inode: 88422,
      },
      server: {
        process: "nginx",
        pid: NGINX_PID,
        fd: 5,
        inode: 12347,
      },
      state: "ESTAB",
    },
    {
      id: "c2",
      clientIp: "203.0.113.174",
      clientPort: 60649,
      client: {
        process: "client-app",
        pid: 2712,
        fd: 7,
        inode: 88423,
      },
      server: {
        process: "nginx",
        pid: NGINX_PID,
        fd: 6,
        inode: 12348,
      },
      state: "ESTAB",
    },
  ];
  state.selected = "c0";
  state.expanded = null;
  state.perspective = "server";
  state.serverFdNext = 7;
  state.serverInodeNext = 12349;
  state.clientInodeNext = 88424;
  state.clientPidNext = 2713;
  connectionId = 3;
  unseenConnectionIds = [];
}

function nextClientIp(): string {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = `203.0.113.${randomInteger(20, 250)}`;

    if (
      !state.connections.some(
        (connection) => connection.clientIp === candidate,
      )
    ) {
      return candidate;
    }
  }

  return `203.0.113.${randomInteger(20, 250)}`;
}

function acceptConnection(): Connection {
  const nextId = connectionId++;
  const connection: Connection = {
    id: `c${nextId}`,
    clientIp: nextClientIp(),
    clientPort: randomInteger(49152, 65535),
    client: {
      process: "client-app",
      pid: state.clientPidNext++,
      fd: 7 + (nextId % 3),
      inode: state.clientInodeNext++,
    },
    server: {
      process: "nginx",
      pid: NGINX_PID,
      fd: state.serverFdNext++,
      inode: state.serverInodeNext++,
    },
    state: "ESTAB",
    fresh: true,
  };

  state.connections.push(connection);
  state.selected = connection.id;
  return connection;
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
}

function endpointReference(
  connection: Connection,
  side: Perspective,
): EndpointReference {
  if (side === "client") {
    return {
      side,
      label: "Client",
      hostLabel: "client host",
      address: connection.clientIp,
      port: connection.clientPort,
      reference: connection.client,
    };
  }

  return {
    side,
    label: "Server",
    hostLabel: "nginx server",
    address: SERVER,
    port: LOCAL_PORT,
    reference: connection.server,
  };
}

function inspectedEndpoints(connection: Connection): {
  local: EndpointReference;
  peer: EndpointReference;
} {
  const local = endpointReference(connection, state.perspective);
  const peer = endpointReference(
    connection,
    state.perspective === "client" ? "server" : "client",
  );

  return { local, peer };
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
  const { local, peer } = inspectedEndpoints(connection);
  const clientIsLocal = state.perspective === "client";

  return (
    `<section class="reference-card port-reference" aria-label="Port references from the ${escapeHtml(local.hostLabel)} perspective">` +
    `<header><span>${escapeHtml(local.label)} host</span><strong>Port</strong></header>` +
    `<h2>Local :${local.port} · peer :${peer.port}</h2>` +
    `<p>From inside the ${escapeHtml(local.hostLabel)}, port ${local.port} is local. The same connection sees port ${peer.port} at its peer.</p>` +
    '<div class="endpoint-pair">' +
    endpointNode(
      `Client endpoint · ${clientIsLocal ? "local" : "peer"}`,
      connection.clientIp,
      connection.clientPort,
      `client ${clientIsLocal ? "local" : "peer"}`,
    ) +
    '<span class="endpoint-arrow" aria-hidden="true">→</span>' +
    endpointNode(
      `nginx endpoint · ${clientIsLocal ? "peer" : "local"}`,
      SERVER,
      LOCAL_PORT,
      `server ${clientIsLocal ? "peer" : "local"}`,
    ) +
    "</div>" +
    "</section>"
  );
}

function socketReference(connection: Connection): string {
  const { local, peer } = inspectedEndpoints(connection);

  return (
    `<section class="reference-card socket-reference" aria-label="${escapeHtml(local.label)} kernel-space socket reference">` +
    `<header><span>${escapeHtml(local.label)} kernel</span><div class="reference-heading"><strong>Socket</strong><small class="space-marker">Kernel space</small></div></header>` +
    `<div class="reference-title-line"><h2>socket:[${local.reference.inode}]</h2><span class="state-badge">${connection.state}</span></div>` +
    `<p>This socket exists only in the ${escapeHtml(local.hostLabel)} kernel. Its peer has a different socket for the same endpoint pair.</p>` +
    `<div class="tuple-grid" aria-label="Local and peer TCP five-tuple from the ${escapeHtml(local.hostLabel)} perspective">` +
    tupleField("Local address", local.address, "address local") +
    tupleField("Local port", String(local.port), "port local") +
    tupleField("Peer address", peer.address, "address peer") +
    tupleField("Peer port", String(peer.port), "port peer") +
    tupleField("Protocol", "TCP", "protocol") +
    "</div>" +
    "</section>"
  );
}

function fdReference(connection: Connection): string {
  const { local } = inspectedEndpoints(connection);
  const { reference } = local;
  const operations = [
    `read(${reference.fd})`,
    `write(${reference.fd})`,
    `close(${reference.fd})`,
  ];

  return (
    `<section class="reference-card fd-reference" aria-label="${escapeHtml(reference.process)} user-space file descriptor reference on the ${escapeHtml(local.hostLabel)}">` +
    `<header><span>${escapeHtml(reference.process)}</span><div class="reference-heading"><strong>File descriptor</strong><small class="space-marker">User space</small></div></header>` +
    `<h2>fd ${reference.fd}</h2>` +
    `<p>The integer is local to ${escapeHtml(reference.process)} on this host. Its FD table reaches this host’s kernel socket.</p>` +
    '<div class="fd-chain" aria-label="File descriptor reference chain">' +
    chainNode("Process", `${reference.process} · ${reference.pid}`, "process") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("FD table slot", `[${reference.fd}]`, "descriptor") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("Open file description", "struct file", "file") +
    '<span class="chain-arrow" aria-hidden="true">↓</span>' +
    chainNode("Kernel object", `socket:[${reference.inode}]`, "socket") +
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
  const perspectiveLabel =
    state.perspective === "client" ? "client host" : "nginx server";

  return (
    '<div class="reference-journey">' +
    '<button class="reference-scroll-cue reference-scroll-cue-left" type="button" aria-label="Scroll to the previous connection reference" disabled><i aria-hidden="true">‹</i></button>' +
    '<button class="reference-scroll-cue reference-scroll-cue-right" type="button" aria-label="Scroll to the next connection reference" disabled><i aria-hidden="true">›</i></button>' +
    `<div class="reference-scroller" tabindex="0" aria-label="Port, socket, and file descriptor references on the ${perspectiveLabel} for the connection from ${escapeHtml(connection.clientIp)}:${connection.clientPort}">` +
    '<div class="reference-track">' +
    portReference(connection) +
    '<span class="reference-arrow" aria-hidden="true">→</span>' +
    socketReference(connection) +
    '<span class="reference-arrow" aria-hidden="true">→</span>' +
    fdReference(connection) +
    "</div>" +
    "</div>" +
    "</div>"
  );
}

function bindReferenceScroller(article: HTMLElement): void {
  const scroller =
    article.querySelector<HTMLElement>(".reference-scroller");
  const leftScrollCue =
    article.querySelector<HTMLButtonElement>(".reference-scroll-cue-left");
  const rightScrollCue =
    article.querySelector<HTMLButtonElement>(".reference-scroll-cue-right");

  if (!scroller || scroller.dataset.bound === "true") {
    return;
  }

  scroller.dataset.bound = "true";
  const updateScrollCue = (): void => {
    if (!leftScrollCue || !rightScrollCue) {
      return;
    }

    const edgeTolerance = 2;
    const maxScrollLeft = Math.max(
      0,
      scroller.scrollWidth - scroller.clientWidth,
    );

    const canScrollLeft = scroller.scrollLeft > edgeTolerance;
    const canScrollRight =
      scroller.scrollLeft < maxScrollLeft - edgeTolerance;

    leftScrollCue.classList.toggle("visible", canScrollLeft);
    leftScrollCue.disabled = !canScrollLeft;
    rightScrollCue.classList.toggle("visible", canScrollRight);
    rightScrollCue.disabled = !canScrollRight;
  };

  const scrollToAdjacentReference = (direction: -1 | 1): void => {
    const cards = Array.from(
      scroller.querySelectorAll<HTMLElement>(".reference-card"),
    );
    const scrollerRect = scroller.getBoundingClientRect();
    const paddingLeft =
      Number.parseFloat(window.getComputedStyle(scroller).paddingLeft) || 0;
    const snapPositions = cards.map(
      (card) =>
        scroller.scrollLeft +
        card.getBoundingClientRect().left -
        scrollerRect.left -
        paddingLeft,
    );
    const positionTolerance = 4;
    const target =
      direction === 1
        ? snapPositions.find(
            (position) =>
              position > scroller.scrollLeft + positionTolerance,
          )
        : [...snapPositions].reverse().find(
            (position) =>
              position < scroller.scrollLeft - positionTolerance,
          );

    if (typeof target === "number") {
      scroller.scrollTo({
        left: target,
        behavior: "smooth",
      });
    }
  };

  scroller.addEventListener("scroll", updateScrollCue, {
    passive: true,
  });
  leftScrollCue?.addEventListener("click", () => {
    scrollToAdjacentReference(-1);
  });
  rightScrollCue?.addEventListener("click", () => {
    scrollToAdjacentReference(1);
  });
  scroller.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      scroller.scrollBy({
        left: event.key === "ArrowRight" ? 360 : -360,
        behavior: "smooth",
      });
    }
  });
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(updateScrollCue);
  });

  new ResizeObserver(updateScrollCue).observe(scroller);
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

function cubicBezierProgress(
  progress: number,
  control1X: number,
  control1Y: number,
  control2X: number,
  control2Y: number,
): number {
  const sample = (time: number, point1: number, point2: number): number => {
    const inverse = 1 - time;

    return (
      3 * inverse * inverse * time * point1 +
      3 * inverse * time * time * point2 +
      time * time * time
    );
  };
  const sampleDerivative = (
    time: number,
    point1: number,
    point2: number,
  ): number => {
    const inverse = 1 - time;

    return (
      3 * inverse * inverse * point1 +
      6 * inverse * time * (point2 - point1) +
      3 * time * time * (1 - point2)
    );
  };
  let curveTime = progress;

  for (let iteration = 0; iteration < 6; iteration += 1) {
    const error = sample(curveTime, control1X, control2X) - progress;
    const derivative = sampleDerivative(
      curveTime,
      control1X,
      control2X,
    );

    if (Math.abs(error) < 0.0001 || Math.abs(derivative) < 0.0001) {
      break;
    }

    curveTime = Math.min(
      1,
      Math.max(0, curveTime - error / derivative),
    );
  }

  return sample(curveTime, control1Y, control2Y);
}

function cancelConnectionReveal(): void {
  if (pendingConnectionRevealTimer !== null) {
    window.clearTimeout(pendingConnectionRevealTimer);
    pendingConnectionRevealTimer = null;
  }

  if (connectionScrollFrame !== null) {
    window.cancelAnimationFrame(connectionScrollFrame);
    connectionScrollFrame = null;
  }
}

function connectionRevealTarget(
  article: HTMLElement,
  initialScrollY: number,
): number {
  const bounds = article.getBoundingClientRect();
  const articleTop = window.scrollY + bounds.top;
  const articleBottom = window.scrollY + bounds.bottom;
  const usableTop = (topbar?.getBoundingClientRect().bottom ?? 0) + 12;
  const usableBottom =
    Math.min(window.innerHeight, controlbar.getBoundingClientRect().top) - 14;
  const usableHeight = Math.max(1, usableBottom - usableTop);
  let target = initialScrollY;

  if (bounds.height > usableHeight) {
    target = articleTop - usableTop;
  } else {
    const minimum = articleBottom - usableBottom;
    const maximum = articleTop - usableTop;
    target = Math.min(Math.max(initialScrollY, minimum), maximum);
  }

  const maximumScroll = Math.max(
    0,
    document.documentElement.scrollHeight - window.innerHeight,
  );

  return Math.min(maximumScroll, Math.max(0, target));
}

function revealExpandedConnection(
  article: HTMLElement,
  connectionIdToReveal: string,
): void {
  const initialScrollY = window.scrollY;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (reducedMotion) {
    connectionScrollFrame = window.requestAnimationFrame(() => {
      connectionScrollFrame = null;

      if (
        state.expanded === connectionIdToReveal &&
        article.isConnected
      ) {
        window.scrollTo(
          0,
          connectionRevealTarget(article, initialScrollY),
        );
      }
    });
    return;
  }

  const startedAt = performance.now();
  const animateScroll = (now: number): void => {
    if (
      state.expanded !== connectionIdToReveal ||
      !article.isConnected
    ) {
      connectionScrollFrame = null;
      return;
    }

    const progress = Math.min(
      1,
      (now - startedAt) / CONNECTION_SCROLL_DURATION_MS,
    );
    const easedProgress = cubicBezierProgress(
      progress,
      0.65,
      0,
      0.35,
      1,
    );
    const target = connectionRevealTarget(article, initialScrollY);
    const nextScrollY =
      initialScrollY + (target - initialScrollY) * easedProgress;

    window.scrollTo(0, nextScrollY);

    if (progress < 1) {
      connectionScrollFrame =
        window.requestAnimationFrame(animateScroll);
      return;
    }

    window.scrollTo(
      0,
      connectionRevealTarget(article, initialScrollY),
    );
    connectionScrollFrame = null;
  };

  connectionScrollFrame = window.requestAnimationFrame(animateScroll);
}

function activateConnection(id: string, forceOpen = false): void {
  const connection = state.connections.find((item) => item.id === id);
  const article = connectionList.querySelector<HTMLElement>(
    `[data-connection-id="${id}"]`,
  );

  if (!connection || !article) {
    return;
  }

  cancelConnectionReveal();
  const previousExpandedId = state.expanded;
  const willExpand = forceOpen || previousExpandedId !== id;
  state.selected = id;
  state.expanded = willExpand ? id : null;
  markSelectedConnection(id);
  renderTopology();

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
    pendingConnectionRevealTimer = window.setTimeout(
      () => {
        pendingConnectionRevealTimer = null;

        if (state.expanded === id && article.isConnected) {
          revealExpandedConnection(article, id);
        }
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : CONNECTION_SCROLL_DELAY_MS,
    );
  }
}

function collapseExpandedConnection(): void {
  cancelConnectionReveal();

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
  const clientInspected = state.perspective === "client";
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
    `<button class="connection-summary" type="button" aria-expanded="${expanded}" aria-controls="${detailsId}" aria-label="${expanded ? "Close" : "Open"} connection from ${escapeHtml(connection.clientIp)}:${connection.clientPort} to nginx ${SERVER}:${LOCAL_PORT}; inspecting the ${clientInspected ? "client host" : "server host"}">` +
    `<span class="lane-endpoint lane-client${clientInspected ? " inspected" : ""}">` +
    '<span>Client host</span>' +
    `<strong>${escapeHtml(connection.clientIp)}:<b>${connection.clientPort}</b></strong>` +
    "</span>" +
    '<span class="connection-thread" aria-hidden="true">' +
    `<span class="thread-state">${connection.state}</span>` +
    '<span class="thread-line"><i></i></span>' +
    "</span>" +
    `<span class="lane-endpoint lane-server${clientInspected ? "" : " inspected"}">` +
    '<span>nginx server</span>' +
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
    ?.addEventListener("click", () => activateConnection(connection.id));
  bindReferenceScroller(article);

  return article;
}

function topologyItems(): TopologyItem[] {
  if (state.connections.length <= TOPOLOGY_VISIBLE_CONNECTIONS) {
    return state.connections.map((connection) => ({
      type: "connection",
      connection,
    }));
  }

  const stableConnections = state.connections.slice(
    0,
    TOPOLOGY_VISIBLE_CONNECTIONS,
  );
  const groupedConnections = state.connections.slice(
    TOPOLOGY_VISIBLE_CONNECTIONS,
  );
  const selectedConnection = groupedConnections.find(
    (connection) => connection.id === state.selected,
  );

  return [
    ...stableConnections.map<TopologyConnectionItem>((connection) => ({
      type: "connection",
      connection,
    })),
    {
      type: "aggregate",
      count: groupedConnections.length,
      selectedConnectionId: selectedConnection?.id ?? null,
      fresh:
        groupedConnections.length === 1 &&
        groupedConnections[0]?.fresh === true,
    },
  ];
}

function topologyItemKey(item: TopologyItem): string {
  return item.type === "connection" ? item.connection.id : "aggregate";
}

function topologyItemY(index: number, itemCount: number): number {
  const centerY = 140;
  const spacing = itemCount >= 4 ? 55 : 70;

  return centerY + (index - (itemCount - 1) / 2) * spacing;
}

function topologyItemTop(index: number, itemCount: number): number {
  return (topologyItemY(index, itemCount) / 280) * 100;
}

function topologyPathFromY(
  startX: number,
  mergeX: number,
  serverY: number,
  y: number,
): string {
  const controlOffset = (mergeX - startX) * 0.48;

  return (
    `M ${startX} ${y} ` +
    `C ${startX + controlOffset} ${y}, ` +
    `${mergeX - controlOffset} ${serverY}, ${mergeX} ${serverY}`
  );
}

function topologyPath(
  startX: number,
  mergeX: number,
  serverY: number,
  index: number,
  itemCount: number,
): string {
  return topologyPathFromY(
    startX,
    mergeX,
    serverY,
    topologyItemY(index, itemCount),
  );
}

function captureTopologyItemYs(): Map<string, number> {
  const topologyBounds = topology.getBoundingClientRect();
  const positions = new Map<string, number>();

  if (topologyBounds.height === 0) {
    return positions;
  }

  topology
    .querySelectorAll<HTMLElement>("[data-topology-item]")
    .forEach((node) => {
      const key = node.dataset.topologyItem;

      if (!key) {
        return;
      }

      const bounds = node.getBoundingClientRect();
      const center = bounds.top + bounds.height / 2;
      positions.set(
        key,
        ((center - topologyBounds.top) / topologyBounds.height) * 280,
      );
    });

  return positions;
}

function animateTopologyLayout(
  previousPositions: Map<string, number>,
  items: TopologyItem[],
  startX: number,
  mergeX: number,
  serverY: number,
): void {
  if (
    previousPositions.size === 0 ||
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }

  const movements = items.flatMap((item, index) => {
    const key = topologyItemKey(item);
    const fromY = previousPositions.get(key);
    const toY = topologyItemY(index, items.length);

    if (typeof fromY !== "number" || Math.abs(fromY - toY) < 0.1) {
      return [];
    }

    return [{ key, fromY, toY }];
  });

  if (movements.length === 0) {
    return;
  }

  const applyProgress = (progress: number): void => {
    movements.forEach(({ key, fromY, toY }) => {
      const y = fromY + (toY - fromY) * progress;
      const node = Array.from(
        topology.querySelectorAll<HTMLElement>("[data-topology-item]"),
      ).find((candidate) => candidate.dataset.topologyItem === key);
      const edge = Array.from(
        topology.querySelectorAll<SVGPathElement>("[data-topology-edge]"),
      ).find((candidate) => candidate.dataset.topologyEdge === key);
      const hitTarget = Array.from(
        topology.querySelectorAll<SVGPathElement>("[data-topology-hit]"),
      ).find((candidate) => candidate.dataset.topologyHit === key);
      const path = topologyPathFromY(startX, mergeX, serverY, y);

      node?.style.setProperty("top", `${(y / 280) * 100}%`);
      edge?.setAttribute("d", path);
      hitTarget?.setAttribute("d", path);
    });
  };

  applyProgress(0);
  const startedAt = performance.now();

  const animateFrame = (now: number): void => {
    const elapsed = now - startedAt;
    const progress = Math.min(1, elapsed / TOPOLOGY_LAYOUT_TRANSITION_MS);
    const easedProgress = 1 - (1 - progress) ** 3;

    applyProgress(easedProgress);

    if (progress < 1) {
      topologyLayoutFrame = window.requestAnimationFrame(animateFrame);
      return;
    }

    movements.forEach(({ key }) => {
      Array.from(
        topology.querySelectorAll<HTMLElement>("[data-topology-item]"),
      )
        .find((candidate) => candidate.dataset.topologyItem === key)
        ?.style.removeProperty("top");
    });
    topologyLayoutFrame = null;
  };

  topologyLayoutFrame = window.requestAnimationFrame(animateFrame);
}

function renderTopology(): void {
  const previousPositions = captureTopologyItemYs();

  if (topologyLayoutFrame !== null) {
    window.cancelAnimationFrame(topologyLayoutFrame);
    topologyLayoutFrame = null;
  }

  const items = topologyItems();
  const narrow = window.matchMedia("(max-width: 640px)").matches;
  const startX = narrow ? 345 : 225;
  const mergeX = narrow ? 600 : 700;
  const endX = narrow ? 655 : 755;
  const serverY = 140;
  const count = state.connections.length;
  const perspectiveLabel =
    state.perspective === "client" ? "client hosts" : "nginx server";
  const paths: string[] = [];
  const nodes: string[] = [];

  items.forEach((item, index) => {
    const key = topologyItemKey(item);
    const path = topologyPath(
      startX,
      mergeX,
      serverY,
      index,
      items.length,
    );
    const top = topologyItemTop(index, items.length);

    if (item.type === "aggregate") {
      const selected = item.selectedConnectionId !== null;
      const classes =
        (selected ? " selected" : "") +
        (selected && state.perspective === "client" ? " inspected" : "") +
        (item.fresh ? " fresh" : "");
      const nodeCopy =
        "<span>Client hosts</span>" +
        `<strong>+${item.count} more</strong>` +
        `<small>${selected ? "Selected connection is here" : "Available in the list"}</small>`;

      paths.push(
        `<path class="topology-edge aggregate${selected ? " selected" : ""}${item.fresh ? " fresh" : ""}" d="${path}" pathLength="1" data-topology-edge="${key}"></path>` +
        (item.selectedConnectionId
          ? `<path class="topology-hit" d="${path}" data-topology-hit="${key}" data-topology-connection="${escapeHtml(item.selectedConnectionId)}" tabindex="0" role="button" aria-label="Inspect the selected connection within ${item.count} grouped client connections"></path>`
          : ""),
      );
      nodes.push(
        item.selectedConnectionId
          ? `<button class="topology-node topology-client topology-cluster${classes}" style="--node-y:${top}%" type="button" data-topology-item="${key}" data-topology-connection="${escapeHtml(item.selectedConnectionId)}" aria-pressed="true" aria-label="Inspect the selected connection within ${item.count} grouped client connections">${nodeCopy}</button>`
          : `<div class="topology-node topology-client topology-cluster" style="--node-y:${top}%" data-topology-item="${key}">${nodeCopy}</div>`,
      );
      return;
    }

    const { connection } = item;
    const selected = connection.id === state.selected;
    const classes =
      (selected ? " selected" : "") +
      (connection.fresh ? " fresh" : "");
    const inspected = selected && state.perspective === "client";
    const ariaLabel =
      `Inspect connection from ${connection.clientIp}:${connection.clientPort} ` +
      `to nginx ${SERVER}:${LOCAL_PORT}`;

    paths.push(
      `<path class="topology-edge${classes}" d="${path}" pathLength="1" data-topology-edge="${key}"></path>` +
      `<path class="topology-hit" d="${path}" data-topology-hit="${key}" data-topology-connection="${escapeHtml(connection.id)}" tabindex="0" role="button" aria-label="${escapeHtml(ariaLabel)}"></path>`,
    );
    nodes.push(
      `<button class="topology-node topology-client${classes}${inspected ? " inspected" : ""}" style="--node-y:${top}%" type="button" data-topology-item="${key}" data-topology-connection="${escapeHtml(connection.id)}" aria-pressed="${selected}">` +
      "<span>Client host</span>" +
      `<strong>${escapeHtml(connection.clientIp)}:<b>${connection.clientPort}</b></strong>` +
      `<small>${selected ? "Selected connection" : "Inspect connection"}</small>` +
      "</button>",
    );
  });

  const firstConnectionFresh =
    count === 1 &&
    items[0]?.type === "connection" &&
    items[0].connection.fresh === true;
  const trunk =
    items.length > 0
      ? `<path class="topology-trunk${firstConnectionFresh ? " fresh" : ""}" d="M ${mergeX} ${serverY} L ${endX} ${serverY}" marker-end="url(#topology-arrow)"></path>`
      : "";
  const emptyClient =
    items.length === 0
      ? '<div class="topology-empty-client"><span>No active clients</span><small>nginx is still listening</small></div>'
      : "";

  topology.className =
    `topology topology-${state.perspective}-perspective`;
  topology.setAttribute(
    "aria-label",
    `${count} active client connection${count === 1 ? "" : "s"} converging on nginx at ${SERVER}:${LOCAL_PORT}. Inspecting from the ${perspectiveLabel} perspective.`,
  );
  topology.innerHTML =
    '<div class="topology-kicker" aria-hidden="true"><span>Many client hosts</span><span>One nginx server</span></div>' +
    '<svg class="topology-lines" viewBox="0 0 1000 280" preserveAspectRatio="none" aria-hidden="true">' +
    '<defs><marker id="topology-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z"></path></marker></defs>' +
    paths.join("") +
    trunk +
    "</svg>" +
    emptyClient +
    nodes.join("") +
    `<div class="topology-node topology-server${state.perspective === "server" ? " inspected" : ""}" style="--node-y:${(serverY / 280) * 100}%">` +
    '<span>nginx server</span>' +
    `<strong>${SERVER}:<b>${LOCAL_PORT}</b></strong>` +
    `<small>${count === 0 ? "Listening" : `${count} connection${count === 1 ? "" : "s"} converge here`}</small>` +
    "</div>";

  animateTopologyLayout(
    previousPositions,
    items,
    startX,
    mergeX,
    serverY,
  );
}

function renderPerspectiveControl(): void {
  perspectiveButtons.forEach((button) => {
    const active = button.dataset.perspective === state.perspective;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function setPerspective(perspective: Perspective): void {
  if (perspective === state.perspective) {
    return;
  }

  const referenceScrollLeft =
    connectionList.querySelector<HTMLElement>(
      ".connection-card.expanded .reference-scroller",
    )?.scrollLeft ?? 0;

  state.perspective = perspective;
  render({
    animatePerspective: true,
    referenceScrollLeft,
  });
}

const ticket = element("req-label");
const topology = element("topology");
const connectionList = element("connection-list");
const serverCount = element("server-count");
const acceptButton = element<HTMLButtonElement>("accept");
const closeButton = element<HTMLButtonElement>("close");
const controlbar = element("controlbar");
const topbar = document.querySelector<HTMLElement>(".topbar");
const newConnectionNotice =
  element<HTMLButtonElement>("new-connection-notice");
const newConnectionNoticeLabel = element("new-connection-notice-label");
const perspectiveButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>("[data-perspective]"),
);

function scheduleNewConnectionNoticeUpdate(): void {
  if (
    unseenConnectionIds.length === 0 ||
    noticeUpdateFrame !== null
  ) {
    if (unseenConnectionIds.length === 0) {
      newConnectionNotice.hidden = true;
    }
    return;
  }

  noticeUpdateFrame = window.requestAnimationFrame(() => {
    noticeUpdateFrame = null;
    updateNewConnectionNotice();
  });
}

function updateNewConnectionNotice(): void {
  const usableTop = (topbar?.getBoundingClientRect().bottom ?? 0) + 8;
  const usableBottom =
    Math.min(window.innerHeight, controlbar.getBoundingClientRect().top) - 10;
  const hiddenBelow: string[] = [];

  unseenConnectionIds = unseenConnectionIds.filter((id) => {
    const card = connectionList.querySelector<HTMLElement>(
      `[data-connection-id="${id}"]`,
    );

    if (!card) {
      return false;
    }

    if (card.classList.contains("fresh")) {
      return true;
    }

    const bounds = card.getBoundingClientRect();

    if (bounds.bottom <= usableTop || bounds.bottom <= usableBottom) {
      return false;
    }

    hiddenBelow.push(id);
    return true;
  });

  if (hiddenBelow.length === 0) {
    newConnectionNotice.hidden = true;
    return;
  }

  const label =
    hiddenBelow.length === 1
      ? "New connection below"
      : `${hiddenBelow.length} new connections below`;
  newConnectionNoticeLabel.textContent = label;
  newConnectionNotice.setAttribute("aria-label", `${label}. Show it.`);
  newConnectionNotice.hidden = false;
}

function queueNewConnectionNotice(id: string): void {
  if (!unseenConnectionIds.includes(id)) {
    unseenConnectionIds.push(id);
  }

  const card = connectionList.querySelector<HTMLElement>(
    `[data-connection-id="${id}"]`,
  );

  if (card?.classList.contains("fresh")) {
    return;
  }

  scheduleNewConnectionNoticeUpdate();
}

function revealNewestConnection(): void {
  const targetId =
    unseenConnectionIds[unseenConnectionIds.length - 1];

  if (!targetId) {
    newConnectionNotice.hidden = true;
    return;
  }

  const card = connectionList.querySelector<HTMLElement>(
    `[data-connection-id="${targetId}"]`,
  );

  if (!card) {
    unseenConnectionIds = [];
    newConnectionNotice.hidden = true;
    return;
  }

  const usableBottom =
    Math.min(window.innerHeight, controlbar.getBoundingClientRect().top) - 14;
  const targetTop =
    window.scrollY + card.getBoundingClientRect().bottom - usableBottom;
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  unseenConnectionIds = [];
  newConnectionNotice.hidden = true;
  window.scrollTo({
    top: Math.max(0, targetTop),
    behavior: reducedMotion ? "auto" : "smooth",
  });

  window.setTimeout(
    () => {
      card
        .querySelector<HTMLButtonElement>(".connection-summary")
        ?.focus({ preventScroll: true });
    },
    reducedMotion ? 0 : 480,
  );
}

function cancelPendingAccept(): void {
  if (pendingAcceptTimer === null) {
    return;
  }

  window.clearTimeout(pendingAcceptTimer);
  pendingAcceptTimer = null;
  acceptButton.disabled = false;
}

function renderConnectionSummary(): void {
  const connectionCount = state.connections.length;

  ticket.innerHTML =
    '<span class="req-method">nginx</span>' +
    `<span class="req-path">listening on ${SERVER}:<b>${LOCAL_PORT}</b></span>`;
  serverCount.textContent =
    `${connectionCount} active connection${connectionCount === 1 ? "" : "s"}`;
}

function commitClientConnection(): void {
  const viewportTop = window.scrollY;
  const connection = acceptConnection();
  const reducedMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;

  if (reducedMotion) {
    connection.fresh = false;
  }

  renderConnectionSummary();
  renderTopology();
  const emptyState =
    connectionList.querySelector<HTMLElement>(".connections-empty");

  if (emptyState && !reducedMotion) {
    connectionList.classList.add("transitioning-from-empty");
    emptyState.classList.add("leaving");
    emptyState.inert = true;
  } else {
    emptyState?.remove();
  }

  markSelectedConnection(connection.id);
  const card = connectionCard(connection);
  connectionList.appendChild(card);

  if (!reducedMotion) {
    let entranceFinished = false;
    const finishEntrance = (): void => {
      if (entranceFinished) {
        return;
      }

      entranceFinished = true;
      card.classList.remove("fresh");
      emptyState?.remove();
      connectionList.classList.remove("transitioning-from-empty");
      scheduleNewConnectionNoticeUpdate();
    };

    card.addEventListener("animationend", (event) => {
      if (
        event.target === card &&
        event.animationName === "connection-card-in"
      ) {
        finishEntrance();
      }
    });
    window.setTimeout(finishEntrance, CONNECTION_ENTRANCE_MS + 100);
  }
  connection.fresh = false;
  closeButton.disabled = false;

  // Existing lanes are left in place and the new lane is appended below them,
  // so accepting a client never replaces the visible list or changes its anchor.
  window.scrollTo(0, viewportTop);
  queueNewConnectionNotice(connection.id);
}

function addClientConnection(): void {
  if (pendingAcceptTimer !== null) {
    return;
  }

  if (!state.expanded) {
    commitClientConnection();
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
    commitClientConnection();
    acceptButton.disabled = false;
  }, transitionDelay);
}

function render(options: RenderOptions = {}): void {
  const connectionCount = state.connections.length;

  renderConnectionSummary();
  renderPerspectiveControl();
  renderTopology();

  connectionList.classList.remove("transitioning-from-empty");
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

  if (options.animatePerspective && state.expanded) {
    connectionList
      .querySelector<HTMLElement>(
        `[data-connection-id="${state.expanded}"]`,
      )
      ?.classList.add("perspective-shift");
  }

  if (
    typeof options.referenceScrollLeft === "number" &&
    state.expanded
  ) {
    requestAnimationFrame(() => {
      const scroller = connectionList.querySelector<HTMLElement>(
        `[data-connection-id="${state.expanded}"] .reference-scroller`,
      );

      if (scroller) {
        scroller.scrollLeft = options.referenceScrollLeft ?? 0;
      }
    });
  }

  scheduleNewConnectionNoticeUpdate();
}

function topologyConnectionId(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) {
    return null;
  }

  return target
    .closest("[data-topology-connection]")
    ?.getAttribute("data-topology-connection") ?? null;
}

function inspectConnectionFromTopology(id: string): void {
  activateConnection(id, true);
  requestAnimationFrame(() => {
    connectionList
      .querySelector<HTMLButtonElement>(
        `[data-connection-id="${id}"] .connection-summary`,
      )
      ?.focus({ preventScroll: true });
  });
}

perspectiveButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const perspective = button.dataset.perspective;

    if (perspective === "client" || perspective === "server") {
      setPerspective(perspective);
    }
  });
});

newConnectionNotice.addEventListener("click", () => {
  revealNewestConnection();
});

topology.addEventListener("click", (event) => {
  const connectionIdFromTopology = topologyConnectionId(event.target);

  if (connectionIdFromTopology) {
    inspectConnectionFromTopology(connectionIdFromTopology);
  }
});

topology.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLButtonElement) {
    return;
  }

  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const connectionIdFromTopology = topologyConnectionId(event.target);

  if (connectionIdFromTopology) {
    event.preventDefault();
    inspectConnectionFromTopology(connectionIdFromTopology);
  }
});

window.addEventListener("resize", () => {
  if (topologyResizeFrame !== null) {
    window.cancelAnimationFrame(topologyResizeFrame);
  }

  topologyResizeFrame = window.requestAnimationFrame(() => {
    topologyResizeFrame = null;
    renderTopology();
  });
  scheduleNewConnectionNoticeUpdate();
});

window.addEventListener(
  "scroll",
  () => {
    scheduleNewConnectionNoticeUpdate();
  },
  { passive: true },
);

window.addEventListener(
  "wheel",
  () => {
    cancelConnectionReveal();
  },
  { passive: true },
);

window.addEventListener(
  "touchstart",
  () => {
    cancelConnectionReveal();
  },
  { passive: true },
);

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
  if (
    [
      "ArrowDown",
      "ArrowUp",
      "End",
      "Home",
      "PageDown",
      "PageUp",
      " ",
    ].includes(event.key)
  ) {
    cancelConnectionReveal();
  }

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
