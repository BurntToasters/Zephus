import { renderNewPageModal } from "./PageModals";
import { focusModalField } from "./modalFocus";
import { normalizePageSlug } from "../shared/pageIdentity";

export interface NewPageProject {
  path: string;
  astro: { pagesDir: string };
}

export interface NewPageDeps {
  getProject: () => NewPageProject | null;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
  ) => void;
  closeModal: () => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  setStatus: (message: string) => void;
  createPage: (
    projectPath: string,
    name: string,
    pagesDir: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  reloadPages: () => Promise<void>;
  loadPage: (page: string) => Promise<void>;
  findCreatedPage: (
    normalizedSlug: string | null,
  ) => { page: string } | undefined;
}

export async function openNewPageModal(deps: NewPageDeps): Promise<void> {
  const {
    getProject,
    showModalNode,
    closeModal,
    registerCleanup,
    setStatus,
    createPage,
    reloadPages,
    loadPage,
    findCreatedPage,
  } = deps;
  if (!getProject()) return;
  let nextName = "";
  let formError = "";
  const wrap = document.createElement("div");
  let dispose: (() => void) | null = null;
  const mount = (): void => {
    dispose?.();
    dispose = renderNewPageModal(wrap, {
      value: nextName,
      formError,
      onValueChange: (value) => {
        nextName = value;
        if (!formError) return;
        formError = "";
        wrap.querySelector(".new-page-error")?.remove();
      },
    });
    registerCleanup(dispose);
  };
  const showProblem = (message: string): void => {
    setStatus(message);
    formError = message;
    mount();
    focusModalField(wrap, ".page-route");
  };
  mount();

  showModalNode("New Page", wrap, [
    { label: "Cancel", kind: "ghost", onClick: closeModal },
    {
      label: "Create Page",
      kind: "primary",
      onClick: async () => {
        const project = getProject();
        const name = nextName.trim();
        if (!project) {
          closeModal();
          return;
        }
        if (!name) {
          showProblem("Enter a page route.");
          return;
        }
        if (!normalizePageSlug(name)) {
          showProblem("Invalid page slug.");
          return;
        }
        closeModal();
        const createdPage = await createPage(
          project.path,
          name,
          project.astro.pagesDir,
        );
        if (!createdPage.ok) {
          setStatus("Create page failed: " + createdPage.error);
          return;
        }
        await reloadPages();
        // Match the normalized slug ("My Page" -> "my-page"), or the list may
        // have refreshed with the normalized name while the raw input still
        // holds the original.
        const normalizedSlug = normalizePageSlug(name);
        const created = findCreatedPage(normalizedSlug);
        if (created) await loadPage(created.page);
        setStatus("Created page " + name);
      },
    },
  ]);
  registerCleanup(dispose);
}
