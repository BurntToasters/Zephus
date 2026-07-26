/** Appends log output to a <pre>, trimming the front when over the cap. */

export const MAX_EDITOR_LOG_CHARS = 100_000;

export function appendCappedLog(
  el: HTMLElement,
  chunk: string,
  maxChars = MAX_EDITOR_LOG_CHARS,
): void {
  const next = (el.textContent ?? "") + chunk;
  el.textContent =
    next.length > maxChars ? next.slice(next.length - maxChars) : next;
  el.scrollTop = el.scrollHeight;
}
