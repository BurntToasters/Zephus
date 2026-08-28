export interface ModalAction {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

export interface ModalOptions {
  size?: "default" | "wide";
    /** Called when Esc is pressed and no Cancel/Close/ghost button exists to activate. */
  onEscapedWithoutAction?: () => void;
}

interface ModalFrame {
  title: string;
  bodyNodes: Node[];
  actionNodes: Node[];
  wide: boolean;
  focused: HTMLElement | null;
  options: ModalOptions | null;
  closeHandler: (() => void) | null;
  cleanup: (() => void) | null;
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
  // Frames of parent modals a child modal opened over. A modal that closes
  // pops its parent's frame back into view instead of destroying it, so
  // nested flows (link picker / asset browser / licenses) return the user to
  // the modal they came from with their in-progress edits intact.
  const frameStack: ModalFrame[] = [];
  // Options of the currently visible modal (tracked across frame pushes/pops
  // so Esc handling can consult the right modal's escape hook).
  let currentOptions: ModalOptions | null = null;
  // Promise-backed modals (choose/promptText) register handler for external
  // close. Bare closeModal must settle them, or callers await forever.
  let currentCloseHandler: (() => void) | null = null;
  let currentCleanup: (() => void) | null = null;

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
    else {
      // No dismissable action: the awaiting code (e.g. choose()) must still
      // settle, or it hangs forever.
      if (currentOptions?.onEscapedWithoutAction) {
        currentOptions.onEscapedWithoutAction();
        return;
      }
      closeModal();
    }
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
    currentOptions = options ?? null;
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
    if (wasOpen) frameStack.push(captureFrame());
    currentCloseHandler = null;
    currentCleanup = null;
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
    if (wasOpen) frameStack.push(captureFrame());
    currentCloseHandler = null;
    currentCleanup = null;
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
      options: currentOptions,
      closeHandler: currentCloseHandler,
      cleanup: currentCleanup,
    };
  }

  function restoreFrame(frame: ModalFrame): void {
    modalElement("modal-title").textContent = frame.title;
    modalElement("modal-body").replaceChildren(...frame.bodyNodes);
    modalElement("modal-actions").replaceChildren(...frame.actionNodes);
    modalElement("modal-shell").classList.toggle("modal-wide", frame.wide);
    modalElement("modal-overlay").classList.remove("hidden");
    currentOptions = frame.options;
    currentCloseHandler = frame.closeHandler;
    currentCleanup = frame.cleanup;
    refreshIcons();
    scheduleModalFocus(frame.focused);
  }

  function closeModal(): void {
    cancelPendingFocus();
    // External close (another modal, close button, project shutdown) must
    // cancel current promise-backed modal before restoring its parent.
    const closeHandler = currentCloseHandler;
    currentCloseHandler = null;
    closeHandler?.();
    const cleanup = currentCleanup;
    currentCleanup = null;
    cleanup?.();
    // A parent frame exists: pop back to it instead of closing the overlay.
    const frame = frameStack.pop();
    if (frame) {
      restoreFrame(frame);
      return;
    }
    applyModalOptions();
    modalElement("modal-overlay").classList.add("hidden");
    setBackgroundInert(false);
    if (keyHandler) {
      document.removeEventListener("keydown", keyHandler, true);
      keyHandler = null;
    }
    // Drop the modal content: removing iframes (theme previews, publish view)
    // from the document unloads them, so they stop running after close.
    modalElement("modal-body").innerHTML = "";
    modalElement("modal-actions").innerHTML = "";
    const returnFocus = lastFocused;
    lastFocused = null;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus();
  }

  function registerCleanup(cleanup: (() => void) | null): void {
    currentCleanup = cleanup;
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
    // The child modal is opened via showModal/showModalNode, which capture the
    // parent frame automatically when one is open.
    const parentExisted = isModalOpen();
    return new Promise((resolve) => {
      let settled = false;
      const closeHandler = (): void => {
        if (settled) return;
        settled = true;
        resolve(undefined as T);
      };
      const finish = (value: T): void => {
        if (settled) return;
        settled = true;
        if (currentCloseHandler === closeHandler) currentCloseHandler = null;
        if (parentExisted) {
          // Pop back to the parent…
          closeModal();
          // …and when the parent must not survive (e.g. a confirmed
          // destructive action), close it too.
          if (!restoreParentWhen(value)) closeModal();
        } else {
          closeModal();
        }
        resolve(value);
      };
      const modalActions = actions.map((action) => ({
        label: action.label,
        kind: action.kind,
        onClick: () => finish(action.value),
      }));

      if (typeof content === "string") {
        showModal(title, content, modalActions, {
          ...options,
          // Esc with no dismissable action must settle the promise (as a
          // cancellation) instead of leaving the caller awaiting forever.
          onEscapedWithoutAction: () => finish(undefined as T),
        });
      } else {
        showModalNode(title, content, modalActions, {
          ...options,
          onEscapedWithoutAction: () => finish(undefined as T),
        });
      }
      currentCloseHandler = closeHandler;
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
      /** Extra context shown above the field (e.g. what the change affects). */
      description?: string;
    } = {},
  ): Promise<string | null> {
    return new Promise((resolve) => {
      const container = document.createElement("div");
      container.className = "meta-form";
      if (opts.description) {
        const note = document.createElement("p");
        note.className = "muted";
        note.textContent = opts.description;
        container.appendChild(note);
      }
      const wrap = document.createElement("label");
      wrap.className = "meta-field";
      container.appendChild(wrap);
      if (opts.label) {
        const span = document.createElement("span");
        span.textContent = opts.label;
        wrap.appendChild(span);
      }
      const input = document.createElement("input");
      input.type = "text";
      input.className = "text";
      if (opts.placeholder) input.placeholder = opts.placeholder;
      // An explicit empty string is a valid prefill.
      if (opts.value !== undefined) input.value = opts.value;
      wrap.appendChild(input);

      let settled = false;
      const finish = (value: string | null): void => {
        if (settled) return;
        settled = true;
        if (currentCloseHandler === closeHandler) currentCloseHandler = null;
        // closeModal pops the parent frame (if any) or hides the overlay.
        closeModal();
        resolve(value);
      };
      const closeHandler = (): void => {
        if (settled) return;
        settled = true;
        resolve(null);
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(input.value.trim() || null);
        }
      });
      showModalNode(title, container, [
        { label: "Cancel", kind: "ghost", onClick: () => finish(null) },
        {
          label: opts.confirmLabel ?? "OK",
          kind: "primary",
          onClick: () => finish(input.value.trim() || null),
        },
      ]);
      currentCloseHandler = closeHandler;
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
    registerCleanup,
    isOpen: isModalOpen,
    choose,
    promptText,
    confirmDestructive,
    confirmRestoreDraft,
    confirmUnsavedWork,
  };
}
