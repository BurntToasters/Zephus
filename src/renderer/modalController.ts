export interface ModalAction {
  label: string;
  kind?: "primary" | "danger" | "ghost";
  onClick: () => void;
}

export interface ModalOptions {
  size?: "default" | "wide";
}

function modalElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing modal element #${id}`);
  return el as T;
}

export function createModalController(refreshIcons: () => void) {
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
      const btn = document.createElement("button");
      btn.className = "btn " + (action.kind ?? "");
      btn.textContent = action.label;
      btn.onclick = action.onClick;
      container.appendChild(btn);
    }
  }

  function showModal(
    title: string,
    body: string,
    actions: ModalAction[],
    options?: ModalOptions,
  ): void {
    modalElement("modal-title").textContent = title;
    modalElement("modal-body").textContent = body;
    applyModalOptions(options);
    buildActions(actions);
    modalElement("modal-overlay").classList.remove("hidden");
    refreshIcons();
  }

  function showModalNode(
    title: string,
    content: HTMLElement,
    actions: ModalAction[],
    options?: ModalOptions,
  ): void {
    modalElement("modal-title").textContent = title;
    const body = modalElement("modal-body");
    body.innerHTML = "";
    body.appendChild(content);
    applyModalOptions(options);
    buildActions(actions);
    modalElement("modal-overlay").classList.remove("hidden");
    refreshIcons();
  }

  function closeModal(): void {
    applyModalOptions();
    modalElement("modal-overlay").classList.add("hidden");
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
  ): Promise<T> {
    return new Promise((resolve) => {
      const finish = (value: T) => {
        closeModal();
        resolve(value);
      };

      if (typeof content === "string") {
        showModal(
          title,
          content,
          actions.map((action) => ({
            label: action.label,
            kind: action.kind,
            onClick: () => finish(action.value),
          })),
          options,
        );
        return;
      }

      showModalNode(
        title,
        content,
        actions.map((action) => ({
          label: action.label,
          kind: action.kind,
          onClick: () => finish(action.value),
        })),
        options,
      );
    });
  }

  async function confirmDestructive(
    title: string,
    body: string | HTMLElement,
    confirmLabel = "Delete",
  ): Promise<boolean> {
    return choose<boolean>(title, body, [
      { label: "Cancel", value: false, kind: "ghost" },
      { label: confirmLabel, value: true, kind: "danger" },
    ]);
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
    choose,
    confirmDestructive,
    confirmRestoreDraft,
    confirmUnsavedWork,
  };
}
