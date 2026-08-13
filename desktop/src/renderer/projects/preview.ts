/** Logo-inspired radar preview driven by project log lines. */

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

export function renderPreviewHtml(projectId: string, running: boolean): string {
  const g = svgId(projectId, "g");
  const sweep = svgId(projectId, "s");
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
          <radialGradient id="${g}" cx="50%" cy="58%" r="55%">
            <stop offset="0" stop-color="#b6e34a" stop-opacity="0.28"/>
            <stop offset="1" stop-color="#064644" stop-opacity="0"/>
          </radialGradient>
          <linearGradient id="${sweep}" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stop-color="#39ff88" stop-opacity="0"/>
            <stop offset="0.72" stop-color="#39ff88" stop-opacity="0.08"/>
            <stop offset="1" stop-color="#b6e34a" stop-opacity="0.55"/>
          </linearGradient>
        </defs>
        <rect width="400" height="108" fill="#02140f"/>
        <rect width="400" height="108" fill="url(#${g})"/>
        <g class="preview-grid" stroke="#39ff88" stroke-opacity="0.12" fill="none">
          <path d="M0 86 H400 M0 94 H400 M0 102 H400"/>
          <path d="M40 70 V108 M80 62 V108 M120 70 V108 M160 58 V108 M200 52 V108 M240 58 V108 M280 70 V108 M320 62 V108 M360 74 V108"/>
        </g>
        <g class="preview-city" fill="#011a19" stroke="#0a6b5f" stroke-width="1">
          <path d="M18 108 V78 h10 V108 M36 108 V64 h14 V108 M58 108 V84 h8 V108"/>
          <path d="M318 108 V80 h12 V108 M338 108 V68 h16 V108 M362 108 V88 h10 V108"/>
          <path d="M168 108 L188 58 H212 L232 108 Z"/>
          <rect x="178" y="72" width="4" height="12" rx="1"/>
          <rect x="218" y="72" width="4" height="12" rx="1"/>
          <rect x="172" y="88" width="6" height="20" rx="1"/>
          <rect x="222" y="88" width="6" height="20" rx="1"/>
        </g>
        <g class="preview-arcs" fill="none" stroke="#b6e34a" stroke-linecap="round">
          <path d="M200 62 m-28 0 a28 16 0 0 1 56 0" stroke-width="1.6" opacity="0.95"/>
          <path d="M200 62 m-52 0 a52 28 0 0 1 104 0" stroke-width="1.35" opacity="0.7"/>
          <path d="M200 62 m-78 0 a78 40 0 0 1 156 0" stroke-width="1.15" opacity="0.45"/>
          <path d="M200 62 m-108 0 a108 52 0 0 1 216 0" stroke-width="1" opacity="0.28"/>
        </g>
        <g class="preview-sweep" style="transform-origin: 200px 62px">
          <path d="M200 62 L308 18" stroke="url(#${sweep})" stroke-width="18" stroke-linecap="round"/>
          <path d="M200 62 L312 16" stroke="#b6e34a" stroke-width="1.4" stroke-opacity="0.9"/>
        </g>
        <circle class="preview-core" cx="200" cy="62" r="5" fill="#b6e34a"/>
        <circle class="preview-core-ring" cx="200" cy="62" r="9" fill="none" stroke="#b6e34a" stroke-width="1.2"/>
        <circle class="preview-packet" cx="92" cy="62" r="2.2" fill="#b6e34a"/>
        <circle class="preview-packet delay" cx="148" cy="62" r="1.8" fill="#9dffc2"/>
      </svg>
      <div class="preview-pings" data-role="preview-pings"></div>
      <div class="preview-live"><span></span> live</div>
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
  const layer = card.querySelector('[data-role="preview-pings"]');
  if (!layer) return;
  const ping = document.createElement("span");
  ping.className = `preview-ping kind-${kind}`;
  ping.style.left = `${10 + Math.random() * 80}%`;
  ping.style.top = `${12 + Math.random() * 52}%`;
  layer.appendChild(ping);
  ping.addEventListener("animationend", () => ping.remove());
  while (layer.children.length > 12) layer.firstElementChild?.remove();
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
