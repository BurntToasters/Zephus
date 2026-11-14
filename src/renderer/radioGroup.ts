/** Roving-tabindex keyboard support for ARIA radiogroups. */

const RADIO_SELECTOR = '[role="radio"]';
const boundGroups = new WeakSet<HTMLElement>();

function groupRadios(group: HTMLElement): HTMLElement[] {
  return Array.from(group.querySelectorAll<HTMLElement>(RADIO_SELECTOR));
}

/**
 * Keeps exactly one radio in the natural tab order, preferring the checked
 * radio so clicks, shortcuts and state restores all leave the group consistent.
 */
export function syncRadioGroupTabIndex(group: HTMLElement | null): void {
  if (!group) return;
  const radios = groupRadios(group);
  if (radios.length === 0) return;
  const checked = radios.findIndex(
    (radio) => radio.getAttribute("aria-checked") === "true",
  );
  const tabbable = radios.findIndex((radio) => radio.tabIndex === 0);
  const active = checked >= 0 ? checked : tabbable >= 0 ? tabbable : 0;
  for (const [index, radio] of radios.entries()) {
    radio.tabIndex = index === active ? 0 : -1;
  }
}

function activateRadio(group: HTMLElement, radio: HTMLElement): void {
  // Reuse the group's existing click wiring; selection stays owned by the
  // feature, never by this helper. Focusing after the click restores the
  // radio when the handler moved focus into the editor (e.g. Code mode).
  radio.click();
  radio.focus();
  syncRadioGroupTabIndex(group);
}

/**
 * Wires ArrowLeft/Up, ArrowRight/Down, Home and End on the radiogroup
 * container. Delegation keeps one listener per group even if a feature
 * re-renders its radios, and repeated calls are ignored.
 */
export function bindRadioGroupKeyboard(group: HTMLElement | null): void {
  if (!group || boundGroups.has(group)) return;
  boundGroups.add(group);

  group.addEventListener("keydown", (event) => {
    if (!(event.target instanceof Element)) return;
    const current = event.target.closest<HTMLElement>(RADIO_SELECTOR);
    if (!current || !group.contains(current)) return;
    const radios = groupRadios(group);
    const index = radios.indexOf(current);
    if (index < 0) return;

    let next: HTMLElement | undefined;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = radios[(index - 1 + radios.length) % radios.length];
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      next = radios[(index + 1) % radios.length];
    } else if (event.key === "Home") {
      next = radios[0];
    } else if (event.key === "End") {
      next = radios.at(-1);
    } else {
      return;
    }
    if (!next) return;
    event.preventDefault();
    activateRadio(group, next);
  });

  syncRadioGroupTabIndex(group);
}
