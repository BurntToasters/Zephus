export interface ModalAction {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

export interface ModalOptions {
  size?: "default" | "wide";
}

interface ModalFrame {
  title: string;
  bodyNodes: Node[];
  actionNodes: Node[];
  wide: boolean;
  focused: HTMLElement | null;
}

function modalElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing modal element #${id}`);
  return el as T;
}

export function createModalController(refreshIcons: () => void) {
  let lastFocused: HTMLElement | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;
  let focusTimer: number | null = null;
  let focusGeneration = 0;

  function isModalOpen(): boolean {
    return !modalElement("modal-overlay").classList.contains("hidden");
  }

  function focusableInModal(): HTMLElement[] {
    const shell = modalElement("modal-shell");
    return Array.from(
      shell.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter(
      (el) =>
        !el.hasAttribute("disabled") &&
        (el.offsetParent !== null || getComputedStyle(el).position === "fixed"),
    );
  }

  function cancelPendingFocus(): void {
    focusGeneration += 1;
    if (focusTimer !== null) {
      window.clearTimeout(focusTimer);
      focusTimer = null;
    }
  }

  function scheduleModalFocus(preferred?: HTMLElement | null): void {
    cancelPendingFocus();
    const generation = focusGeneration;
    focusTimer = window.setTimeout(() => {
      focusTimer = null;
      if (generation !== focusGeneration || !isModalOpen()) return;
      const target =
        preferred && document.contains(preferred)
          ? preferred
          : (focusableInModal()[0] ?? modalElement("modal-shell"));
      target.focus();
    }, 0);
  }

  /** Esc activates a Cancel/Close button if present, else just closes. */
  function escapeClose(): void {
    const buttons = Array.from(
      modalElement("modal-actions").querySelectorAll<HTMLButtonElement>(
        "button",
      ),
    );
    const cancel =
      buttons.find((button) =>
        /cancel|close|done/i.test(button.textContent ?? ""),
      ) ?? buttons.find((button) => button.classList.contains("ghost"));
    if (cancel) cancel.click();
    else closeModal();
  }

  function onModalKeydown(e: KeyboardEvent): void {
    if (!isModalOpen()) return;
    if (e.key === "Escape") {
      e.preventDefault();
      escapeClose();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = focusableInModal();
    if (focusable.length === 0) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    const activeEl = document.activeElement as HTMLElement | null;
    if (e.shiftKey && activeEl === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeEl === last) {
      e.preventDefault();
      first.focus();
    }
  }

  /** While a modal is open, make the background views inert to AT + tabbing. */
  function setBackgroundInert(on: boolean): void {
    for (const id of ["view-start", "view-editor"]) {
      const el = document.getElementById(id);
      if (!el) continue;
      if (on) el.setAttribute("inert", "");
      else el.removeAttribute("inert");
    }
  }

  function activateFocusTrap(wasOpen: boolean): void {
    if (!wasOpen) {
      lastFocused = document.activeElement as HTMLElement | null;
      setBackgroundInert(true);
    }
    if (!keyHandler) {
      keyHandler = onModalKeydown;
      document.addEventListener("keydown", keyHandler, true);
    }
    scheduleModalFocus();
  }

  function applyModalOptions(options?: ModalOptions): void {
    modalElement("modal-shell").classList.toggle(
      "modal-wide",
      options?.size === "wide",
    );
  }

  function buildActions(actions: ModalAction[]): void {
    const container = modalElement("modal-actions");
    container.innerHTML = "";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn " + (action.kind ?? "");
      button.textContent = action.label;
      button.onclick = action.onClick;
      container.appendChild(button);
    }
  }

  function finishShowing(wasOpen: boolean): void {
    modalElement("modal-overlay").classList.remove("hidden");
    refreshIcons();
    activateFocusTrap(wasOpen);
  }

  function showModal(
    title: string,
    body: string,
    actions: ModalAction[],
    options?: ModalOptions,
  ): void {
    const wasOpen = isModalOpen();
    modalElement("modal-title").textContent = title;
    modalElement("modal-body").textContent = body;
    applyModalOptions(options);
    buildActions(actions);
    finishShowing(wasOpen);
  }

  function showModalNode(
    title: string,
    content: HTMLElement,
    actions: ModalAction[],
    options?: ModalOptions,
  ): void {
    const wasOpen = isModalOpen();
    modalElement("modal-title").textContent = title;
    const body = modalElement("modal-body");
    body.innerHTML = "";
    body.appendChild(content);
    applyModalOptions(options);
    buildActions(actions);
    finishShowing(wasOpen);
  }

  function captureFrame(): ModalFrame {
    const shell = modalElement("modal-shell");
    const active = document.activeElement;
    return {
      title: modalElement("modal-title").textContent ?? "",
      bodyNodes: Array.from(modalElement("modal-body").childNodes),
      actionNodes: Array.from(modalElement("modal-actions").childNodes),
      wide: shell.classList.contains("modal-wide"),
      focused:
        active instanceof HTMLElement && shell.contains(active) ? active : null,
    };
  }

  function restoreFrame(frame: ModalFrame): void {
    modalElement("modal-title").textContent = frame.title;
    modalElement("modal-body").replaceChildren(...frame.bodyNodes);
    modalElement("modal-actions").replaceChildren(...frame.actionNodes);
    modalElement("modal-shell").classList.toggle("modal-wide", frame.wide);
    modalElement("modal-overlay").classList.remove("hidden");
    refreshIcons();
    scheduleModalFocus(frame.focused);
  }

  function closeModal(): void {
    cancelPendingFocus();
    applyModalOptions();
    modalElement("modal-overlay").classList.add("hidden");
    setBackgroundInert(false);
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler, true);
      keyHandler = null;
    }
    const returnFocus = lastFocused;
    lastFocused = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  function choose<T>(
    title: string,
    content: string | HTMLElement,
    actions: Array<{
      label: string;
      value: T;
      kind?: "primary" | "danger" | "ghost";
    }>,
    options?: ModalOptions,
    restoreParentWhen: (value: T) => boolean = () => true,
  ): Promise<T> {
    const parent = isModalOpen() ? captureFrame() : null;
    return new Promise((resolve) => {
      let settled = false;
      const finish = (value: T): void => {
        if (settled) return;
        settled = true;
        if (parent && restoreParentWhen(value)) restoreFrame(parent);
        else closeModal();
        resolve(value);
      };
      const modalActions = actions.map((action) => ({
        label: action.label,
        kind: action.kind,
        onClick: () => finish(action.value),
      }));

      if (typeof content === "string") {
        showModal(title, content, modalActions, options);
      } else {
        showModalNode(title, content, modalActions, options);
      }
    });
  }

  /** Accessible text-input modal replacing the native prompt(). */
  function promptText(
    title: string,
    opts: {
      label?: string;
      placeholder?: string;
      value?: string;
      confirmLabel?: string;
    } = {},
  ): Promise<string | null> {
    const parent = isModalOpen() ? captureFrame() : null;
    return new Promise((resolve) => {
      const wrap = document.createElement("label");
      wrap.className = "meta-field";
      if (opts.label) {
        const span = document.createElement("span");
        span.textContent = opts.label;
        wrap.appendChild(span);
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "text";
      if (opts.placeholder) input.placeholder = opts.placeholder;
      if (opts.value) input.value = opts.value;
      wrap.appendChild(input);

      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        if (parent) restoreFrame(parent);
        else closeModal();
        resolve(value);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(input.value.trim() || null);
        }
      });
      showModalNode(title, wrap, [
        { label: "Cancel", kind: "ghost", onClick: () => finish(null) },
        {
          label: opts.confirmLabel ?? "OK",
          kind: "primary",
          onClick: () => finish(input.value.trim() || null),
        },
      ]);
    });
  }

  async function confirmDestructive(
    title: string,
    body: string | HTMLElement,
    confirmLabel = "Delete",
  ): Promise<boolean> {
    return choose<boolean>(
      title,
      body,
      [
        { label: "Cancel", value: false, kind: "ghost" },
        { label: confirmLabel, value: true, kind: "danger" },
      ],
      undefined,
      (confirmed) => !confirmed,
    );
  }

  async function confirmRestoreDraft(
    title: string,
    body: string | HTMLElement,
  ): Promise<"restore" | "discard" | "cancel"> {
    return choose<"restore" | "discard" | "cancel">(
      title,
      body,
      [
        { label: "Cancel", value: "cancel", kind: "ghost" },
        { label: "Discard Draft", value: "discard", kind: "danger" },
        { label: "Restore Draft", value: "restore", kind: "primary" },
      ],
      { size: "wide" },
    );
  }

  async function confirmUnsavedWork(
    title: string,
    content: HTMLElement,
  ): Promise<"save" | "discard" | "cancel"> {
    return choose<"save" | "discard" | "cancel">(
      title,
      content,
      [
        { label: "Cancel", value: "cancel", kind: "ghost" },
        { label: "Discard", value: "discard", kind: "danger" },
        { label: "Save", value: "save", kind: "primary" },
      ],
      { size: "wide" },
    );
  }

  return {
    showModal,
    showModalNode,
    closeModal,
    isOpen: isModalOpen,
    choose,
    promptText,
    confirmDestructive,
    confirmRestoreDraft,
    confirmUnsavedWork,
  };
}
