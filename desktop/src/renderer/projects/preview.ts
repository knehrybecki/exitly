/** Crawl-graph preview driven by project log lines. */

export type PreviewKind =
  | "idle"
  | "boot"
  | "crawl"
  | "vpn"
  | "mcp"
  | "ok"
  | "warn"
  | "error";

export type PreviewState = {
  kind: PreviewKind;
  lines: string[];
  running: boolean;
};

const MAX_STREAM = 4;
const states = new Map<string, PreviewState>();
const pingAt = new Map<string, number>();

export function getPreviewState(id: string): PreviewState {
  let state = states.get(id);
  if (!state) {
    state = { kind: "idle", lines: [], running: false };
    states.set(id, state);
  }
  return state;
}

export function dropPreviewState(id: string): void {
  states.delete(id);
  pingAt.delete(id);
}

export function classifyLogLine(line: string): PreviewKind {
  const s = line.toLowerCase();
  if (
    /error|exception|fatal|traceback|failed|eacces|denied|cannot|crash/.test(s)
  ) {
    return "error";
  }
  if (/warn|retry|timeout|captcha|blocked|429|rate.?limit/.test(s)) {
    return "warn";
  }
  if (/wireguard|wg0|vpn|proton|connected|exit node|tunnel/.test(s)) {
    return "vpn";
  }
  if (/\bmcp\b|json-?rpc|jsonrpc/.test(s)) return "mcp";
  if (
    /https?:\/\/|\bget |\bpost |\bcrawl|fetch|scrap|visit|url=|request/.test(s)
  ) {
    return "crawl";
  }
  if (/listening|started|ready|ok\b|done|saved|success/.test(s)) return "ok";
  if (/start|boot|init|compos|pulling|creating/.test(s)) return "boot";
  return "crawl";
}

export function ingestPreviewLine(
  id: string,
  line: string,
  opts?: { running?: boolean; ping?: boolean },
): PreviewState {
  const text = String(line || "").replace(/\s+/g, " ").trim();
  if (!text) return getPreviewState(id);
  const state = getPreviewState(id);
  state.kind = classifyLogLine(text);
  if (opts?.running != null) state.running = opts.running;
  state.lines = [...state.lines, text].slice(-MAX_STREAM);
  const card = document.querySelector(
    `.project-card[data-id="${cssEscape(id)}"]`,
  );
  if (card) applyPreviewToCard(card, id, state.running);
  if (opts?.ping !== false) maybePing(id, state.kind);
  return state;
}

export function seedPreviewLines(
  id: string,
  text: string,
  running: boolean,
): PreviewState {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l && !/^\(/.test(l))
    .slice(-MAX_STREAM);
  const state = getPreviewState(id);
  state.running = running;
  if (lines.length) {
    state.lines = lines;
    state.kind = classifyLogLine(lines[lines.length - 1] || "");
  } else if (!running) {
    state.kind = "idle";
  }
  return state;
}

function svgId(projectId: string, name: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 28) || "p";
  return `pv-${safe}-${name}`;
}

const CRAWL_PATH =
  "M48 54 C70 40 96 30 120 28 C150 36 178 46 200 50 C220 36 234 24 248 22 C280 28 310 36 332 40 C348 52 356 68 360 78 C330 82 290 76 268 72 C240 80 210 86 186 88 C156 84 138 80 128 78 C88 72 62 64 48 54";

const CRAWL_NODES: Array<{ x: number; y: number; seed?: boolean }> = [
  { x: 48, y: 54, seed: true },
  { x: 120, y: 28 },
  { x: 128, y: 78 },
  { x: 200, y: 50 },
  { x: 248, y: 22 },
  { x: 268, y: 72 },
  { x: 186, y: 88 },
  { x: 332, y: 40 },
  { x: 360, y: 78 },
];

function pageNode(x: number, y: number, seed = false): string {
  const extra = seed ? " seed" : "";
  return `<g class="preview-node${extra}" transform="translate(${x} ${y})">
    <rect x="-7" y="-9" width="14" height="17" rx="2"/>
    <path d="M-3.5 -4 h7 M-3.5 0 h7 M-3.5 4 h4.5"/>
  </g>`;
}

export function renderPreviewHtml(projectId: string, running: boolean): string {
  const glow = svgId(projectId, "g");
  const state = getPreviewState(projectId);
  state.running = running;
  const kind = running ? state.kind || "boot" : "idle";
  const stream = previewStreamHtml(state, running);
  return `
    <div class="project-preview" data-role="preview" data-running="${
      running ? "true" : "false"
    }" data-kind="${kind}">
      <svg class="preview-scene" viewBox="0 0 400 108" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <radialGradient id="${glow}" cx="30%" cy="50%" r="70%">
            <stop offset="0" stop-color="#b6e34a" stop-opacity="0.16"/>
            <stop offset="1" stop-color="#064644" stop-opacity="0"/>
          </radialGradient>
        </defs>
        <rect width="400" height="108" fill="#02140f"/>
        <rect width="400" height="108" fill="url(#${glow})"/>
        <g class="preview-web" fill="none" stroke="#39ff88">
          <path class="preview-link" d="M48 54 L120 28 L200 50 L248 22 L332 40 L360 78"/>
          <path class="preview-link alt" d="M48 54 L128 78 L186 88 L268 72 L360 78"/>
          <path class="preview-link" d="M120 28 L128 78 M200 50 L268 72 M248 22 L200 50 L186 88"/>
          <path class="preview-route" d="${CRAWL_PATH}"/>
        </g>
        ${CRAWL_NODES.map((n) => pageNode(n.x, n.y, n.seed)).join("")}
        <circle class="preview-fetch" r="2.4" fill="#b6e34a"/>
        <circle class="preview-fetch delay" r="1.8" fill="#9dffc2"/>
        <g class="preview-spider">
          <path class="leg a" d="M0 0 L-9 -7"/>
          <path class="leg b" d="M0 0 L-10 -1"/>
          <path class="leg a" d="M0 0 L-9 6"/>
          <path class="leg b" d="M0 0 L-7 8"/>
          <path class="leg a" d="M0 0 L9 -7"/>
          <path class="leg b" d="M0 0 L10 -1"/>
          <path class="leg a" d="M0 0 L9 6"/>
          <path class="leg b" d="M0 0 L7 8"/>
          <ellipse class="abdomen" cx="-3.2" cy="1.2" rx="5.2" ry="3.4"/>
          <circle class="cephalon" cx="3.4" cy="-0.4" r="3.1"/>
        </g>
      </svg>
      <div class="preview-pings" data-role="preview-pings"></div>
      <div class="preview-live"><span></span> crawl</div>
      <div class="preview-stream" data-role="preview-stream">${stream}</div>
    </div>`;
}

function previewStreamHtml(state: PreviewState, running: boolean): string {
  const lines = state.lines.slice(-MAX_STREAM);
  if (!lines.length) {
    const fallback = running ? "nasłuchiwanie logów…" : "projekt w uśpieniu";
    return `<p class="preview-line muted">${escapePreview(fallback)}</p>`;
  }
  return lines
    .map(
      (line, i) =>
        `<p class="preview-line${i === lines.length - 1 ? " current" : ""}">${escapePreview(
          line,
        )}</p>`,
    )
    .join("");
}

function escapePreview(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applyPreviewToCard(
  card: ParentNode,
  id: string,
  running: boolean,
): void {
  const root = card.querySelector<HTMLElement>('[data-role="preview"]');
  if (!root) return;
  const state = getPreviewState(id);
  state.running = running;
  root.dataset.running = running ? "true" : "false";
  root.dataset.kind = running ? state.kind || "boot" : "idle";
  const stream = root.querySelector('[data-role="preview-stream"]');
  if (stream) stream.innerHTML = previewStreamHtml(state, running);
}

function spawnPreviewPing(card: ParentNode, kind: PreviewKind): void {
  const nodes = card.querySelectorAll(".preview-node");
  if (!nodes.length) return;
  const node = nodes[Math.floor(Math.random() * nodes.length)];
  node.classList.remove("hot", "kind-error", "kind-warn", "kind-vpn");
  const extra =
    kind === "error" || kind === "warn"
      ? `kind-${kind}`
      : kind === "vpn" || kind === "mcp"
        ? "kind-vpn"
        : "";
  requestAnimationFrame(() => {
    node.classList.add("hot");
    if (extra) node.classList.add(extra);
  });
  window.setTimeout(() => {
    node.classList.remove("hot", "kind-error", "kind-warn", "kind-vpn");
  }, 720);
}

function maybePing(id: string, kind: PreviewKind): void {
  const now = Date.now();
  const last = pingAt.get(id) || 0;
  if (now - last < 90) return;
  pingAt.set(id, now);
  const card = document.querySelector(`.project-card[data-id="${cssEscape(id)}"]`);
  if (!card) return;
  spawnPreviewPing(card, kind);
}

function cssEscape(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/"/g, '\\"');
}
