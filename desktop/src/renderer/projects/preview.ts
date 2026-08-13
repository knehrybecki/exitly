/** Compact per-project log strip. Motion lives on the shared page background. */

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

const MAX_STREAM = 1;
const states = new Map<string, PreviewState>();

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
  opts?: { running?: boolean },
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

export function renderPreviewHtml(projectId: string, running: boolean): string {
  const state = getPreviewState(projectId);
  state.running = running;
  const kind = running ? state.kind || "boot" : "idle";
  return `
    <div class="project-preview" data-role="preview" data-running="${
      running ? "true" : "false"
    }" data-kind="${kind}">
      <div class="preview-stream" data-role="preview-stream">${previewStreamHtml(state, running)}</div>
    </div>`;
}

function previewStreamHtml(state: PreviewState, running: boolean): string {
  const line = state.lines[state.lines.length - 1];
  if (!line) {
    const fallback = running ? "nasłuchiwanie logów…" : "projekt w uśpieniu";
    return `<p class="preview-line muted">${escapePreview(fallback)}</p>`;
  }
  return `<p class="preview-line current">${escapePreview(line)}</p>`;
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

export function bindPreviewMotion(): void {
  const syncHidden = () => {
    document.documentElement.classList.toggle("motion-paused", document.hidden);
  };
  const syncFocus = () => {
    document.documentElement.classList.toggle(
      "window-inactive",
      !document.hasFocus(),
    );
  };
  document.addEventListener("visibilitychange", syncHidden);
  window.addEventListener("blur", syncFocus);
  window.addEventListener("focus", syncFocus);
  syncHidden();
  syncFocus();
}

function cssEscape(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/"/g, '\\"');
}
