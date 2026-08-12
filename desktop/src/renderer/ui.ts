export const $ = <T extends Element = HTMLElement>(sel: string): T =>
  document.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string): T[] =>
  [...document.querySelectorAll(sel)] as T[];

export function requireEl<T extends Element = HTMLElement>(
  root: ParentNode,
  sel: string,
): T {
  const node = root.querySelector(sel);
  if (!node) throw new Error(`Missing element: ${sel}`);
  return node as T;
}

export function qs<T extends Element = HTMLElement>(
  root: ParentNode,
  sel: string,
): T | null {
  return root.querySelector(sel) as T | null;
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type UiEls = {
  setup: HTMLElement;
  main: HTMLElement;
  settings: HTMLElement;
  projectList: HTMLElement;
  busyBar: HTMLElement;
  log: HTMLElement;
  error: HTMLElement;
  [key: string]: HTMLElement | null;
};

let busy = false;

export function isBusy(): boolean {
  return busy;
}

export function log(el: HTMLElement | null, line: string): void {
  if (!el) return;
  const stamp = new Date().toLocaleTimeString("pl-PL");
  el.textContent += `[${stamp}] ${line}\n`;
  el.scrollTop = el.scrollHeight;
}

export function setError(el: HTMLElement, msg: string): void {
  if (!msg) {
    el.classList.add("hidden");
    el.textContent = "";
    return;
  }
  el.classList.remove("hidden");
  el.textContent = msg;
}

export function setBusy(
  busyBar: HTMLElement,
  on: boolean,
  opts?: { preserveIds?: string[] },
): void {
  busy = on;
  busyBar.classList.toggle("hidden", !on);
  const preserve = new Set(opts?.preserveIds || []);
  $$("button, input, select").forEach((node) => {
    const el = node as HTMLButtonElement | HTMLInputElement | HTMLSelectElement;
    if (preserve.has(el.id)) return;
    if (el.closest(".update-banner")) return;
    if (el.closest(".project-logs")) return;
    el.disabled = on;
  });
}
