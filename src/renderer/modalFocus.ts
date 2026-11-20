/**
 * A failure that happens while a dialog is open. The status bar sits under
 * the overlay, so the message has to live in the dialog itself.
 */
export function showInlineAlert(
  root: HTMLElement,
  className: string,
  message: string,
): HTMLElement {
  let alert = root.querySelector<HTMLElement>(`.${className}`);
  if (!alert) {
    alert = root.ownerDocument.createElement("p");
    alert.className = `form-error ${className}`;
    alert.setAttribute("role", "alert");
    root.prepend(alert);
  }
  alert.hidden = false;
  alert.textContent = message;
  return alert;
}

/** True when Tab and the modal focus trap should land on this element. */
export function includeInModalTabOrder(el: HTMLElement): boolean {
  if (!el.isConnected || el.hasAttribute("disabled") || el.tabIndex < 0) {
    return false;
  }
  const view = el.ownerDocument.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.visibility === "hidden" || style.display === "none") return false;
  return el.offsetParent !== null || style.position === "fixed";
}

/**
 * Focus a field on the next turn. Closing a nested dialog already schedules
 * focus onto the first control, and that timer has to lose to the field the
 * user was filling in.
 */
export function focusModalField(root: ParentNode, selector: string): void {
  window.setTimeout(() => {
    const field = root.querySelector<HTMLElement>(selector);
    if (!field?.isConnected) return;
    field.focus();
    const editable = field as HTMLInputElement;
    if (typeof editable.setSelectionRange !== "function") return;
    const end = editable.value.length;
    try {
      editable.setSelectionRange(end, end);
    } catch {
      // Some input types cannot hold a caret.
    }
  }, 0);
}
