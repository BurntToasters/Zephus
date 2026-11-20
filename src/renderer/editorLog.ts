/** Appends log output to a <pre>, trimming the front when over the cap. */

export const MAX_EDITOR_LOG_CHARS = 100_000;

/** Follow new lines only when the reader is already this close to the end. */
const LOG_STICK_PX = 32;

export function appendCappedLog(
  el: HTMLElement,
  chunk: string,
  maxChars = MAX_EDITOR_LOG_CHARS,
): void {
  const pinnedToEnd =
    el.scrollHeight - el.scrollTop - el.clientHeight <= LOG_STICK_PX;
  const next = (el.textContent ?? "") + chunk;
  el.textContent =
    next.length > maxChars ? next.slice(next.length - maxChars) : next;
  if (pinnedToEnd) el.scrollTop = el.scrollHeight;
}
