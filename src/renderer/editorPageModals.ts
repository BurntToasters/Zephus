/** Page settings + asset browser modals. */

import {
  AssetBrowserModalEntry,
  renderAssetBrowserModalBody,
} from "./AssetBrowserModal";
import { renderPageSettingsModal } from "./PageModals";
import type { AssetAction } from "./assetKeyboard";
import { focusModalField } from "./modalFocus";
import { linkPickerProblem } from "./linkPickerCommit";
import { settlePageDraftWrite } from "./editorDraft";
import { encodeSiteDraftContent } from "./editorDraftRestore";
import { effectiveSiteDocument, isGlobalDirty } from "./editorSession";
import type {
  AssetEntry,
  AssetMutationResult,
  AssetUsageResult,
  OperationResult,
} from "../main/types";
import { routeForSlug } from "../shared/pageIdentity";

interface AssetBrowserOptions {
  filter?: AssetEntry["category"] | "all";
  title?: string;
  onSelect: (webPath: string) => void;
}

export interface PageModalDeps {
  getState: () => import("./editorSession").EditorSessionState;
  setStatus: (message: string) => void;
  closeModal: () => void;
  registerCleanup: (cleanup: (() => void) | null) => void;
  refreshIcons: () => void;
  modalController: {
    confirmDestructive: (
      title: string,
      message: string,
      confirmLabel: string,
    ) => Promise<boolean>;
    promptText: (
      title: string,
      opts?: {
        label?: string;
        placeholder?: string;
        value?: string;
        confirmLabel?: string;
        description?: string;
      },
    ) => Promise<string | null>;
  };
  maybeResolveUnsavedWork: (options?: {
    reloadCurrentPageOnDiscard?: boolean;
  }) => Promise<boolean>;
  reloadPages: () => Promise<void>;
  loadPage: (
    page: string,
    options?: {
      skipUnsavedGuard?: boolean;
      skipDraftRestore?: boolean;
      restoreDraftSilently?: boolean;
      forceReload?: boolean;
      afterLoad?: () => void | Promise<void>;
    },
  ) => Promise<void>;
  getCode: () => string;
  syncCurrentMeta: () => void;
  resetOpenPageState: () => void;
  normalizePageSlugInput: (input: string) => string | null;
  isReservedNotFoundSlug: (slug: string) => boolean;
  invalidateAssetCache: (webPath: string) => void;
  fetchAssetDataUrl: (webPath: string) => Promise<string | null>;
  reloadSiteDocumentFromDisk: () => Promise<void>;
  showModalNode: (
    title: string,
    content: HTMLElement,
    actions: Array<{
      label: string;
      kind?: "primary" | "danger" | "ghost";
      onClick: () => void;
    }>,
    options?: { size?: "default" | "wide" },
  ) => void;
  editorSaveWaitForIdle: () => Promise<void>;
  editorSaveIsSaving: () => boolean;
  patchOpenPageLayoutTitle: (title: string) => void;
  pageDraftContent: () => string;
  siteDraftContent?: () => string;
}

export function createPageModalActions(deps: PageModalDeps) {
  const {
    getState,
    setStatus,
    closeModal,
    registerCleanup,
    refreshIcons,
    modalController,
    maybeResolveUnsavedWork,
    reloadPages,
    loadPage,
    getCode,
    syncCurrentMeta,
    resetOpenPageState,
    normalizePageSlugInput,
    isReservedNotFoundSlug,
    invalidateAssetCache,
    fetchAssetDataUrl,
    reloadSiteDocumentFromDisk,
    showModalNode,
    editorSaveWaitForIdle,
    editorSaveIsSaving,
    patchOpenPageLayoutTitle,
    pageDraftContent,
    siteDraftContent,
  } = deps;

  const state = getState();

  async function settleRenamedPageDraft(
    projectPath: string,
    page: string,
    failurePrefix: string,
  ): Promise<void> {
    const content = pageDraftContent();
    const revision = state.pageRevision;
    await settlePageDraftWrite(
      state,
      {
        writeDraft: window.zephus.writeDraft.bind(window.zephus),
        clearDraft: window.zephus.clearDraft.bind(window.zephus),
        pageDraftContent,
        siteDraftContent:
          siteDraftContent ??
          (() => {
            const site = effectiveSiteDocument(state);
            return site
              ? encodeSiteDraftContent(site, state.pendingSiteEditorKind)
              : "";
          }),
        onDraftWriteFailure: (error) => {
          setStatus(failurePrefix + (error || "unknown"));
        },
      },
      projectPath,
      page,
      revision,
      content,
    );
  }

  /** Formats a thrown action (including a rejected IPC call) for the status line. */
  const actionErrorMessage = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  /**
   * Runs an async modal action and reports a thrown/rejected call in the status
   * line instead of leaving an unhandled rejection or a dead button behind.
   * Returns false when the action failed so callers can skip success messages.
   */
  async function runModalAction(
    label: string,
    action: () => Promise<void>,
    onError?: (message: string) => void,
  ): Promise<boolean> {
    try {
      await action();
      return true;
    } catch (error) {
      const message = `${label}: ${actionErrorMessage(error)}`;
      if (onError) onError(message);
      else setStatus(message);
      return false;
    }
  }

  async function openPageMetaModal(page: string): Promise<void> {
    if (!state.project) return;
    let entry: PageMeta;
    let doc: PageDocumentResult;
    try {
      entry = await window.zephus.readPageMeta(
        state.project.path,
        page,
        state.project.astro.pagesDir,
      );
      doc = await window.zephus.readPageDocument(
        state.project.path,
        page,
        state.project.astro.pagesDir,
      );
    } catch (error) {
      setStatus(
        "Could not open page settings: " +
          (error instanceof Error ? error.message : String(error)),
      );
      return;
    }

    const formState = {
      title: entry.title,
      slug: entry.slug,
      navLabel: entry.navLabel,
      description: entry.metaDescription,
      visible: entry.navVisible,
      socialImage: entry.socialImage,
      canonicalUrl: entry.canonicalUrl,
      noindex: entry.noindex,
      publishDate: entry.publishDate,
      author: entry.author,
      formError: "",
    };

    const wrap = document.createElement("div");
    const clearPageSettingsError = (): void => {
      if (!formState.formError) return;
      formState.formError = "";
      wrap.querySelector(".page-settings-error")?.remove();
    };
    wrap.addEventListener("input", clearPageSettingsError);
    wrap.addEventListener("change", clearPageSettingsError);
    let pageSettingsDispose: (() => void) | null = null;
    const showPageSettingsError = (
      message: string,
      focusSelector = ".page-title",
    ): void => {
      setStatus(message);
      formState.formError = message;
      mountPageSettings();
      focusModalField(wrap, focusSelector);
    };
    const mountPageSettings = () => {
      pageSettingsDispose?.();
      pageSettingsDispose = renderPageSettingsModal(wrap, {
        title: formState.title,
        slug: formState.slug,
        slugDisabled: entry.isHome,
        navLabel: formState.navLabel,
        metaDescription: formState.description,
        navVisible: formState.visible,
        socialImage: formState.socialImage,
        canonicalUrl: formState.canonicalUrl,
        noindex: formState.noindex,
        publishDate: formState.publishDate,
        author: formState.author,
        siteUrl: effectiveSiteDocument(state)?.siteUrl ?? "",
        route: entry.route,
        formError: formState.formError,
        onTitleChange: (value) => {
          const wasAutoNavLabel = formState.navLabel === formState.title;
          formState.title = value;
          // If the nav label was never hand-set (it still mirrors the title),
          // keep it in sync — otherwise the page list shows a stale label.
          // The field is not a signal, so the stored value has to be written
          // into the input or the dialog keeps showing the old label.
          if (wasAutoNavLabel && value.trim()) {
            formState.navLabel = value;
            const field =
              wrap.querySelector<HTMLInputElement>(".page-nav-label");
            if (field && document.activeElement !== field) field.value = value;
          }
        },
        onSlugChange: (value) => {
          const wasReservedNotFound = isReservedNotFoundSlug(formState.slug);
          formState.slug = value;
          const isReservedNotFound = isReservedNotFoundSlug(value.trim());
          if (isReservedNotFound) {
            formState.visible = false;
            formState.noindex = true;
          } else if (wasReservedNotFound) {
            formState.visible = true;
            formState.noindex = false;
          }
          if (wasReservedNotFound !== isReservedNotFound) {
            mountPageSettings();
            focusModalField(wrap, ".page-slug");
          }
        },
        onNavLabelChange: (value) => {
          formState.navLabel = value;
        },
        onMetaDescriptionChange: (value) => {
          formState.description = value;
        },
        onNavVisibleChange: (value) => {
          formState.visible = value;
        },
        onSocialImageChange: (value) => {
          formState.socialImage = value;
        },
        onCanonicalUrlChange: (value) => {
          formState.canonicalUrl = value;
        },
        onNoindexChange: (value) => {
          formState.noindex = value;
        },
        onPublishDateChange: (value) => {
          formState.publishDate = value;
        },
        onAuthorChange: (value) => {
          formState.author = value;
        },
        onPickSocialImage: () => {
          openAssetBrowser({
            filter: "images",
            title: "Choose Social Share Image",
            onSelect: (webPath) => {
              formState.socialImage = webPath;
              mountPageSettings();
              focusModalField(wrap, ".page-social-image");
            },
          });
        },
      });
      registerCleanup(pageSettingsDispose);
    };
    mountPageSettings();

    showModalNode("Page Settings", wrap, [
      {
        label: "Delete",
        kind: "danger",
        onClick: () =>
          runModalAction(
            "Delete failed",
            async () => {
              if (editorSaveIsSaving()) {
                showPageSettingsError(
                  "Finish the current save before deleting a page.",
                );
                return;
              }
              if (entry.isHome) {
                showPageSettingsError("Home page cannot be deleted.");
                return;
              }
              const confirmed = await modalController.confirmDestructive(
                "Delete Page",
                `Delete page "${entry.navLabel}" and remove route ${entry.route}?`,
                "Delete Page",
              );
              if (!confirmed) {
                return;
              }
              // Deleting the open page with unsaved edits must not silently discard
              // them: resolve save/discard/cancel first (the switch path guards this
              // via maybeResolveUnsavedWork; the delete path previously did not).
              if (state.page === entry.page && isGlobalDirty(state)) {
                const resolved = await maybeResolveUnsavedWork();
                if (!resolved) return;
              }
              const deleted = await window.zephus.deletePage(
                state.project!.path,
                entry.page,
                state.project!.astro.pagesDir,
              );
              if (!deleted.ok) {
                showPageSettingsError(
                  "Delete failed: " + (deleted.error ?? "unknown"),
                );
                return;
              }
              closeModal();
              // The page is gone at this point: finish the follow-up work under
              // its own guard so a cleanup failure cannot look like a failed
              // delete or skip the list refresh entirely.
              const cleanedUp = await runModalAction(
                "Deleted page, but cleanup failed",
                async () => {
                  // Always clear the deleted page's recovery draft so the home screen
                  // stops offering "Resume" for a page that no longer exists — whether
                  // or not it was the open page.
                  await window.zephus.clearDraft(
                    state.project!.path,
                    "page",
                    entry.page,
                  );
                  if (state.page === entry.page) {
                    // Drop the deleted page's document state entirely (a phantom
                    // document would otherwise be written by a later Save).
                    resetOpenPageState();
                  }
                  await reloadPages();
                  if (!state.page && state.project?.pages[0]) {
                    await loadPage(state.project.pages[0]);
                  }
                },
              );
              if (cleanedUp) {
                setStatus(`Deleted page ${entry.navLabel}.`);
              }
            },
            showPageSettingsError,
          ),
      },
      {
        label: "Duplicate",
        kind: "ghost",
        onClick: () =>
          runModalAction(
            "Duplicate failed",
            async () => {
              const duplicated = await window.zephus.duplicatePage(
                state.project!.path,
                entry.page,
                state.project!.astro.pagesDir,
              );
              if (!duplicated.ok) {
                showPageSettingsError(
                  "Duplicate failed: " + (duplicated.error ?? "unknown"),
                );
                return;
              }
              closeModal();
              const reloaded = await runModalAction(
                "Duplicated page, but the page list could not refresh",
                reloadPages,
              );
              if (reloaded) {
                setStatus(`Duplicated page ${entry.navLabel}.`);
              }
            },
            showPageSettingsError,
          ),
      },
      {
        label:
          doc.ok && doc.pageDocument?.detached
            ? "Reattach Visual"
            : "Detach Visual",
        kind: "ghost",
        onClick: () =>
          runModalAction(
            doc.ok && doc.pageDocument?.detached
              ? "Reattach failed"
              : "Detach failed",
            async () => {
              if (!state.project) return;
              if (
                state.page === entry.page &&
                isGlobalDirty(state) &&
                !(await maybeResolveUnsavedWork())
              ) {
                return;
              }
              if (!state.project) return;
              if (doc.ok && doc.pageDocument?.detached) {
                const reattached = await window.zephus.reattachPageDocument(
                  state.project.path,
                  entry.page,
                  state.project.astro.pagesDir,
                );
                if (!reattached.ok) {
                  setStatus(
                    "Reattach failed: " + (reattached.error ?? "unknown"),
                  );
                  return;
                }
                closeModal();
                const reloaded = await runModalAction(
                  "Reattached, but the page could not reload",
                  () => loadPage(entry.page, { forceReload: true }),
                );
                if (reloaded) {
                  setStatus(`Reattached ${entry.navLabel} to visual mode.`);
                }
                return;
              }
              const openSource =
                state.page === entry.page
                  ? state.mode === "code"
                    ? (getCode() ?? state.rawCode)
                    : state.rawCode
                  : (doc.source ?? state.rawCode);
              const detached = await window.zephus.detachPageDocument(
                state.project.path,
                entry.page,
                state.project.astro.pagesDir,
                openSource,
              );
              if (!detached.ok) {
                showPageSettingsError(
                  "Detach failed: " + (detached.error ?? "unknown"),
                );
                return;
              }
              closeModal();
              if (state.page === entry.page) {
                const reloaded = await runModalAction(
                  "Detached, but the page could not reload",
                  () => loadPage(entry.page, { forceReload: true }),
                );
                if (!reloaded) return;
              }
              setStatus(`Detached ${entry.navLabel} from visual mode.`);
            },
            showPageSettingsError,
          ),
      },
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Save",
        kind: "primary",
        onClick: () =>
          runModalAction(
            "Save failed",
            async () => {
              if (!state.project) return;
              const project = state.project;
              await editorSaveWaitForIdle();
              const nextSlug =
                normalizePageSlugInput(formState.slug) ?? entry.slug;
              let nextPage = entry.page;
              if (!entry.isHome && nextSlug !== entry.slug) {
                // Suppress the app's own rename event: the file watcher would
                // otherwise surface a spurious "File Changed on Disk" prompt for
                // the deletion of the old path.
                // Stop the watcher only when the rename touches the open page (its
                // old path disappears). Any other page can be renamed with the open
                // page's watcher left running.
                const renameIsOpenPage = state.page === entry.page;
                if (renameIsOpenPage) {
                  await window.zephus.stopWatch();
                }
                let renamed: OperationResult;
                try {
                  renamed = await window.zephus.renamePage(
                    project.path,
                    entry.page,
                    project.astro.pagesDir,
                    nextSlug,
                  );
                } catch (error) {
                  // The watcher was stopped above; re-arm it on the original path
                  // so external edits to the open page keep being detected.
                  if (renameIsOpenPage && state.page === entry.page) {
                    await window.zephus
                      .watchFile(project.path, entry.page)
                      .catch(() => {});
                  }
                  showPageSettingsError(
                    "Rename failed: " + actionErrorMessage(error),
                    ".page-slug",
                  );
                  return;
                }
                if (!renamed.ok) {
                  // The watcher was stopped above; re-arm it on the original path
                  // so external edits to the open page keep being detected.
                  if (renameIsOpenPage && state.page === entry.page) {
                    await window.zephus.watchFile(project.path, entry.page);
                  }
                  showPageSettingsError(
                    "Rename failed: " + (renamed.error ?? "unknown"),
                    ".page-slug",
                  );
                  return;
                }
                // Derive the new path from the slug + extension, never by string
                // replacing the slug inside the path (a directory segment that
                // repeats the slug would produce a wrong path).
                const dot = entry.page.lastIndexOf(".");
                const ext = dot > 0 ? entry.page.slice(dot) : ".astro";
                const pagesDir = project.astro.pagesDir.replace(/\/+$/, "");
                const name =
                  nextSlug === "index" ? `index${ext}` : `${nextSlug}${ext}`;
                nextPage = pagesDir ? `${pagesDir}/${name}` : name;
                if (renameIsOpenPage) {
                  state.page = nextPage;
                  syncCurrentMeta();
                }
                if (renameIsOpenPage && isGlobalDirty(state)) {
                  await settleRenamedPageDraft(
                    project.path,
                    nextPage,
                    "Rename succeeded but the recovery draft could not move: ",
                  );
                }
              }
              const canonicalProblem = linkPickerProblem(
                formState.canonicalUrl.trim(),
              );
              if (canonicalProblem) {
                showPageSettingsError(canonicalProblem, ".page-canonical");
                return;
              }
              const socialProblem = linkPickerProblem(
                formState.socialImage.trim(),
              );
              if (socialProblem) {
                showPageSettingsError(socialProblem, ".page-social-image");
                return;
              }
              const meta = {
                title: formState.title.trim() || entry.title,
                navLabel:
                  formState.navLabel.trim() ||
                  formState.title.trim() ||
                  entry.navLabel,
                metaDescription: formState.description.trim(),
                navVisible: formState.visible,
                socialImage: formState.socialImage.trim(),
                canonicalUrl: formState.canonicalUrl.trim(),
                noindex: formState.noindex,
                publishDate: formState.publishDate.trim(),
                author: formState.author.trim(),
              };
              let saved: OperationResult;
              try {
                saved = await window.zephus.writePageMeta(
                  project.path,
                  nextPage,
                  project.astro.pagesDir,
                  meta,
                );
              } catch (error) {
                // The rename already succeeded on disk; if the open page was
                // renamed, the editor must follow it to the new path. Otherwise it
                // would keep pointing at the deleted old path and a later Save
                // would resurrect that file, silently duplicating the page.
                if (nextPage !== entry.page && state.page === entry.page) {
                  state.page = nextPage;
                  syncCurrentMeta();
                  await window.zephus
                    .watchFile(project.path, nextPage)
                    .catch(() => {});
                }
                showPageSettingsError(
                  "Metadata save failed: " + actionErrorMessage(error),
                );
                return;
              }
              if (!saved.ok) {
                // The rename already succeeded on disk; if the open page was
                // renamed, the editor must follow it to the new path. Otherwise it
                // would keep pointing at the deleted old path and a later Save
                // would resurrect that file, silently duplicating the page.
                if (nextPage !== entry.page && state.page === entry.page) {
                  state.page = nextPage;
                  syncCurrentMeta();
                  await window.zephus
                    .watchFile(project.path, nextPage)
                    .catch(() => {});
                }
                showPageSettingsError(
                  "Metadata save failed: " + (saved.error ?? "unknown"),
                );
                return;
              }
              closeModal();
              const reloadedPages = await runModalAction(
                "Saved page settings, but the page list could not refresh",
                reloadPages,
              );
              // The session document must reflect the metadata write, or the NEXT
              // page save regenerates from the stale doc and silently reverts the
              // title/label/SEO edits just made.
              if (
                (state.page === entry.page || state.page === nextPage) &&
                state.pageDocument
              ) {
                state.pageDocument = {
                  ...state.pageDocument,
                  page: nextPage,
                  slug: nextSlug,
                  route: routeForSlug(nextSlug),
                  isHome: nextSlug === "index",
                  ...meta,
                };
                syncCurrentMeta();
              }
              if (nextPage !== entry.page) {
                // The old slug's recovery draft is orphaned by the rename: its
                // content is unreachable under the old path and its home card
                // would linger forever. Clear it (the new slug has no draft yet —
                // fresh edits will create one under the new key).
                let clearedOld: OperationResult | null = null;
                try {
                  clearedOld = await window.zephus.clearDraft(
                    project.path,
                    "page",
                    entry.page,
                  );
                } catch (error) {
                  setStatus(
                    "Saved page settings, but the old page's recovery draft could not be cleared: " +
                      actionErrorMessage(error),
                  );
                }
                if (clearedOld && !clearedOld.ok) {
                  setStatus(
                    "Saved page settings, but the old page's recovery draft could not be cleared: " +
                      (clearedOld.error ?? "unknown"),
                  );
                } else if (
                  clearedOld?.ok &&
                  state.page === nextPage &&
                  isGlobalDirty(state)
                ) {
                  await settleRenamedPageDraft(
                    project.path,
                    nextPage,
                    "Saved page settings, but the recovery draft could not be updated: ",
                  );
                }
              }
              const openPageMatches =
                state.page === entry.page || state.page === nextPage;
              let pageReloaded = true;
              if (openPageMatches) {
                state.page = nextPage;
                syncCurrentMeta();
                await window.zephus
                  .watchFile(project.path, nextPage)
                  .catch(() => {
                    setStatus(
                      "Warning: could not watch the page for external edits.",
                    );
                  });
                if (!isGlobalDirty(state)) {
                  pageReloaded = await runModalAction(
                    "Saved page settings, but the page could not reload",
                    () =>
                      loadPage(nextPage, {
                        forceReload: true,
                        skipDraftRestore: true,
                        skipUnsavedGuard: true,
                      }),
                  );
                } else {
                  patchOpenPageLayoutTitle(meta.title);
                }
              }
              if (reloadedPages && pageReloaded) {
                setStatus(`Saved page settings for ${entry.navLabel}.`);
              }
            },
            showPageSettingsError,
          ),
      },
    ]);
    registerCleanup(pageSettingsDispose);
  }
  function openAssetBrowser(options: AssetBrowserOptions): void {
    if (!state.project) return;
    const project = state.project;
    const filter = options.filter ?? "all";
    const wrap = document.createElement("div");
    const modalState = {
      assets: [] as AssetBrowserModalEntry[],
      dragActive: false,
      formError: "",
    };
    let disposeAssetBody: (() => void) | null = null;
    let pendingFocus: { webPath: string; kind: AssetAction } | null = null;

    const focusAssetButton = (
      focus: { webPath: string; kind: AssetAction } | null,
    ): void => {
      if (!focus) return;
      const buttons = [...wrap.querySelectorAll<HTMLButtonElement>("button")];
      const match = (kind: AssetAction) =>
        buttons.find(
          (button) =>
            button.dataset["assetPath"] === focus.webPath &&
            button.dataset["assetAction"] === kind &&
            !button.disabled,
        );
      const target = match(focus.kind) ?? match("select");
      if (target) {
        target.focus();
        return;
      }
      wrap.parentElement?.parentElement
        ?.querySelector<HTMLButtonElement>("#modal-actions button")
        ?.focus();
    };

    const renderModal = () => {
      const focus = pendingFocus;
      pendingFocus = null;
      disposeAssetBody?.();
      disposeAssetBody = renderAssetBrowserModalBody(wrap, {
        assets: modalState.assets,
        dragActive: modalState.dragActive,
        initialStop: focus,
        emptyMessage: "No assets yet. Import or drop files to get started.",
        onDragActiveChange: (active) => {
          // The component tracks drag state with a local signal; re-rendering
          // here would destroy the drop target mid-drag and cancel the drop.
          modalState.dragActive = active;
        },
        onDropFiles: (files) => {
          void handleDroppedFiles(files);
        },
        onSelect: (webPath) => {
          // A replaced file on disk must not serve stale cached bytes.
          invalidateAssetCache(webPath);
          closeModal();
          options.onSelect(webPath);
        },
        onRendered: refreshIcons,
        onRename: (asset) => void renameAssetFlow(asset),
        onDelete: (asset) => void deleteAssetFlow(asset),
        formError: modalState.formError,
      });
      focusAssetButton(focus);
    };

    const showAssetError = (
      message: string,
      focus?: { webPath: string; kind: AssetAction },
    ): void => {
      setStatus(message);
      modalState.formError = message;
      if (focus) pendingFocus = focus;
      renderModal();
    };

    const clearAssetError = (): void => {
      modalState.formError = "";
    };

    type AssetUsageScan = {
      usedBy: string;
      usageGap?: string;
      scanFailed?: string;
    };

    /** Summarizes where an asset is used, for the confirm prompts. */
    const describeUsage = async (webPath: string): Promise<AssetUsageScan> => {
      let usage: AssetUsageResult;
      try {
        usage = await window.zephus.findAssetUsage(
          project.path,
          project.astro.pagesDir,
          webPath,
        );
      } catch (error) {
        return {
          usedBy: "",
          scanFailed: actionErrorMessage(error),
        };
      }
      if (!usage.ok) {
        return {
          usedBy: "",
          scanFailed: usage.error ?? "Could not scan project pages.",
        };
      }
      const usageGap = (usage as { usageGap?: string }).usageGap;
      const places = [
        ...usage.pages.map((entry) => entry.label),
        ...usage.siteReferences,
      ];
      if (places.length === 0) {
        return { usedBy: "", usageGap };
      }
      const shown = places.slice(0, 6).join(", ");
      const extra = places.length > 6 ? ` and ${places.length - 6} more` : "";
      return { usedBy: `${shown}${extra}`, usageGap };
    };

    const renameAssetFlow = async (
      asset: AssetBrowserModalEntry,
    ): Promise<void> => {
      await runModalAction(
        "Rename failed",
        async () => {
          const currentName = asset.fileName.split("/").pop() ?? asset.fileName;
          const dotIndex = currentName.lastIndexOf(".");
          const stem =
            dotIndex > 0 ? currentName.slice(0, dotIndex) : currentName;
          const extension = dotIndex > 0 ? currentName.slice(dotIndex) : "";
          const usageSummary = await describeUsage(asset.webPath);
          const nextName = await modalController.promptText("Rename Asset", {
            label: `New name (keeps ${extension || "the same type"})`,
            value: stem,
            confirmLabel: "Rename",
            description: usageSummary.scanFailed
              ? `Usage scan failed (${usageSummary.scanFailed}). Renaming may miss references in unscanned pages.`
              : usageSummary.usedBy
                ? `Used by: ${usageSummary.usedBy}. Renaming updates those references too.${
                    usageSummary.usageGap
                      ? ` Note: ${usageSummary.usageGap}.`
                      : ""
                  }`
                : usageSummary.usageGap
                  ? `No saved references found, but ${usageSummary.usageGap}.`
                  : undefined,
          });
          if (!nextName || nextName.trim() === stem) return;

          // Repointing rewrites saved page sidecars, so unsaved edits must be settled
          // first — otherwise saving afterwards would write back the old asset path.
          if (isGlobalDirty(state) && !(await maybeResolveUnsavedWork())) {
            showAssetError(
              "Rename canceled: save or discard your changes first.",
              { webPath: asset.webPath, kind: "rename" },
            );
            return;
          }

          let result: AssetMutationResult;
          try {
            result = await window.zephus.renameAsset(
              project.path,
              project.astro.publicDir,
              project.astro.pagesDir,
              asset.webPath,
              nextName,
            );
          } catch (error) {
            showAssetError("Rename failed: " + actionErrorMessage(error), {
              webPath: asset.webPath,
              kind: "rename",
            });
            await runModalAction(
              "Could not refresh assets",
              () =>
                refresh({
                  kind: "path",
                  webPath: asset.webPath,
                  action: "rename",
                }),
              showAssetError,
            );
            return;
          }
          if (!result.ok || !result.webPath) {
            showAssetError("Rename failed: " + (result.error ?? "unknown"), {
              webPath: asset.webPath,
              kind: "rename",
            });
            await runModalAction(
              "Could not refresh assets",
              () =>
                refresh({
                  kind: "path",
                  webPath: asset.webPath,
                  action: "rename",
                }),
              showAssetError,
            );
            return;
          }
          // Drop cached data-URLs for both the old and the new path so the canvas
          // re-reads the file instead of serving a stale (or wrong-file) copy.
          invalidateAssetCache(asset.webPath);
          invalidateAssetCache(result.webPath);

          const updated = result.updatedReferences ?? 0;
          // The open page and site document were changed on disk by the repoint, so
          // reload them rather than leaving the editor on a stale copy.
          clearAssetError();
          const reloaded = await runModalAction(
            "Renamed asset, but the editor could not reload",
            async () => {
              await reloadSiteDocumentFromDisk();
              if (state.page) {
                await loadPage(state.page, {
                  skipUnsavedGuard: true,
                  skipDraftRestore: true,
                  forceReload: true,
                });
              }
            },
            showAssetError,
          );
          const refreshed = await runModalAction(
            "Could not refresh assets",
            () =>
              refresh({
                kind: "path",
                webPath: result.webPath ?? asset.webPath,
                action: "rename",
              }),
            showAssetError,
          );
          if (reloaded && refreshed) {
            setStatus(
              updated > 0
                ? `Renamed asset and updated ${updated} reference(s).`
                : "Renamed asset.",
            );
          }
        },
        showAssetError,
      );
    };

    const deleteAssetFlow = async (
      asset: AssetBrowserModalEntry,
    ): Promise<void> => {
      await runModalAction(
        "Delete failed",
        async () => {
          const displayName = asset.fileName.split("/").pop() ?? asset.fileName;
          const usageSummary = await describeUsage(asset.webPath);
          const deletePrompt = usageSummary.scanFailed
            ? `Could not verify whether "${displayName}" is still in use (${usageSummary.scanFailed}). Delete anyway?`
            : usageSummary.usedBy
              ? `"${displayName}" is still used by: ${usageSummary.usedBy}. Deleting it will leave those places pointing at a missing file. Delete anyway?`
              : usageSummary.usageGap
                ? `No saved references were found for "${displayName}", but ${usageSummary.usageGap}. Delete anyway?`
                : `Delete "${displayName}" from this project? This removes the file from disk.`;
          const confirmed = await modalController.confirmDestructive(
            "Delete Asset",
            deletePrompt,
            "Delete Asset",
          );
          if (!confirmed) return;

          let result: AssetMutationResult;
          try {
            result = await window.zephus.deleteAsset(
              project.path,
              project.astro.publicDir,
              asset.webPath,
            );
          } catch (error) {
            showAssetError("Delete failed: " + actionErrorMessage(error), {
              webPath: asset.webPath,
              kind: "delete",
            });
            return;
          }
          if (!result.ok) {
            showAssetError("Delete failed: " + (result.error ?? "unknown"), {
              webPath: asset.webPath,
              kind: "delete",
            });
            return;
          }
          // The freed name can be reclaimed by a later import; drop the cached
          // data-URL so the canvas never keeps showing the deleted file's bytes.
          invalidateAssetCache(asset.webPath);
          clearAssetError();
          setStatus(`Deleted ${displayName}.`);
          await runModalAction(
            "Could not refresh assets",
            () =>
              refresh({
                kind: "neighbor",
                webPath: asset.webPath,
                action: "delete",
              }),
            showAssetError,
          );
        },
        showAssetError,
      );
    };

    const resolvePreviewSrc = async (
      asset: AssetEntry,
    ): Promise<string | undefined> => {
      if (asset.category !== "images") return undefined;
      // Reuse the canvas asset cache: the old path re-fetched and base64-encoded
      // the same files (up to 60 per refresh) and duplicated canvas fetches.
      const dataUrl = await fetchAssetDataUrl(asset.webPath);
      return dataUrl ?? undefined;
    };

    const resolveAssetFocus = (
      previous: AssetBrowserModalEntry[],
      next: AssetBrowserModalEntry[],
      hint?: {
        kind: "path" | "neighbor";
        webPath: string;
        action: AssetAction;
      },
    ): { webPath: string; kind: AssetAction } | null => {
      if (!hint) return null;
      if (hint.kind === "path") {
        return next.some((asset) => asset.webPath === hint.webPath)
          ? { webPath: hint.webPath, kind: hint.action }
          : null;
      }
      const index = previous.findIndex(
        (asset) => asset.webPath === hint.webPath,
      );
      const neighbor =
        index >= 0 ? (next[index] ?? next[index - 1]) : undefined;
      return neighbor ? { webPath: neighbor.webPath, kind: hint.action } : null;
    };

    let refreshSeq = 0;
    const refresh = async (hint?: {
      kind: "path" | "neighbor";
      webPath: string;
      action: AssetAction;
    }): Promise<void> => {
      const seq = ++refreshSeq;
      const previous = modalState.assets;
      const result = await window.zephus.listAssets(
        project.path,
        project.astro.publicDir,
      );
      if (seq !== refreshSeq) return; // a newer refresh superseded this one
      const assets = (result.ok ? result.assets : []).filter(
        (a) => filter === "all" || a.category === filter,
      );
      // Hydrating EVERY image as a full base64 data URL in parallel froze the
      // main process and ballooned RAM on large asset libraries (hundreds of
      // multi-MB payloads). Cap the hydrated set; later entries render with a
      // placeholder icon instead of a preview.
      const PREVIEW_HYDRATION_CAP = 60;
      modalState.assets = await Promise.all(
        assets.map(async (asset, index) => ({
          category: asset.category,
          fileName: asset.fileName,
          previewSrc:
            index < PREVIEW_HYDRATION_CAP
              ? await resolvePreviewSrc(asset)
              : undefined,
          size: asset.size,
          webPath: asset.webPath,
        })),
      );
      if (seq !== refreshSeq) return;
      pendingFocus = resolveAssetFocus(previous, modalState.assets, hint);
      renderModal();
    };

    const handleDroppedFiles = async (files: File[]): Promise<void> => {
      if (files.length === 0) return;
      modalState.dragActive = false;
      try {
        await runModalAction(
          "Import failed",
          async () => {
            renderModal();
            const res = await window.zephus.importAssetPaths(
              project.path,
              project.astro.publicDir,
              files,
            );
            if (res.errors.length > 0) {
              const message = `Some files failed to import: ${res.errors.join("; ")}`;
              setStatus(message);
              modalState.formError = message;
            } else {
              clearAssetError();
              setStatus(`Imported ${res.imported.length} file(s).`);
            }
            await runModalAction(
              "Could not refresh assets",
              refresh,
              showAssetError,
            );
          },
          showAssetError,
        );
      } finally {
        // Never leave the drop target stuck in its busy visual state.
        modalState.dragActive = false;
      }
    };

    renderModal();
    void runModalAction("Could not load assets", refresh, showAssetError);

    showModalNode(options.title ?? "Asset Browser", wrap, [
      {
        label: "Import Files",
        kind: "primary",
        onClick: () =>
          runModalAction(
            "Import failed",
            async () => {
              if (!state.project) return;
              const res = await window.zephus.importAssets(
                project.path,
                project.astro.publicDir,
              );
              if (res.errors.length > 0) {
                const message = `Some files failed: ${res.errors.join("; ")}`;
                setStatus(message);
                modalState.formError = message;
              } else if (res.imported.length > 0) {
                clearAssetError();
                setStatus(`Imported ${res.imported.length} file(s).`);
              }
              await runModalAction(
                "Could not refresh assets",
                refresh,
                showAssetError,
              );
            },
            showAssetError,
          ),
      },
      { label: "Close", kind: "ghost", onClick: closeModal },
    ]);
    // Dispose the Solid root on close (not just on re-mount): every open/close
    // previously leaked one root + its For computations.
    registerCleanup(disposeAssetBody);
  }

  return {
    openPageMetaModal: openPageMetaModal,
    openAssetBrowser: openAssetBrowser,
  };
}
