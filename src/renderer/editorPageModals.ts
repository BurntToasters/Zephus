/** Page settings + asset browser modals. */

import {
  AssetBrowserModalEntry,
  renderAssetBrowserModalBody,
} from "./AssetBrowserModal";
import { renderPageSettingsModal } from "./PageModals";
import { effectiveSiteDocument, isGlobalDirty } from "./editorSession";
import type { AssetEntry } from "../main/types";

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
  } = deps;

  const state = getState();

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
    };

    const wrap = document.createElement("div");
    let pageSettingsDispose: (() => void) | null = null;
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
        onTitleChange: (value) => {
          const wasAutoNavLabel = formState.navLabel === formState.title;
          formState.title = value;
          // If the nav label was never hand-set (it still mirrors the title),
          // keep it in sync — otherwise the page list shows a stale label.
          if (wasAutoNavLabel && value.trim()) {
            formState.navLabel = value;
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
        onClick: async () => {
          if (entry.isHome) {
            setStatus("Home page cannot be deleted.");
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
            setStatus("Delete failed: " + (deleted.error ?? "unknown"));
            return;
          }
          closeModal();
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
          setStatus(`Deleted page ${entry.navLabel}.`);
        },
      },
      {
        label: "Duplicate",
        kind: "ghost",
        onClick: async () => {
          const duplicated = await window.zephus.duplicatePage(
            state.project!.path,
            entry.page,
            state.project!.astro.pagesDir,
          );
          if (!duplicated.ok) {
            setStatus("Duplicate failed: " + (duplicated.error ?? "unknown"));
            return;
          }
          closeModal();
          await reloadPages();
          setStatus(`Duplicated page ${entry.navLabel}.`);
        },
      },
      {
        label:
          doc.ok && doc.pageDocument?.detached
            ? "Reattach Visual"
            : "Detach Visual",
        kind: "ghost",
        onClick: async () => {
          if (!state.project) return;
          if (doc.ok && doc.pageDocument?.detached) {
            const reattached = await window.zephus.reattachPageDocument(
              state.project.path,
              entry.page,
              state.project.astro.pagesDir,
            );
            if (!reattached.ok) {
              setStatus("Reattach failed: " + (reattached.error ?? "unknown"));
              return;
            }
            closeModal();
            await loadPage(entry.page, { forceReload: true });
            setStatus(`Reattached ${entry.navLabel} to visual mode.`);
            return;
          }
          const currentSource = getCode() ?? state.rawCode;
          const detached = await window.zephus.detachPageDocument(
            state.project.path,
            entry.page,
            state.project.astro.pagesDir,
            state.page === entry.page
              ? currentSource
              : (doc.source ?? currentSource),
          );
          if (!detached.ok) {
            setStatus("Detach failed: " + (detached.error ?? "unknown"));
            return;
          }
          closeModal();
          if (state.page === entry.page) {
            await loadPage(entry.page, { forceReload: true });
          }
          setStatus(`Detached ${entry.navLabel} from visual mode.`);
        },
      },
      { label: "Cancel", kind: "ghost", onClick: closeModal },
      {
        label: "Save",
        kind: "primary",
        onClick: async () => {
          if (!state.project) return;
          const nextSlug = normalizePageSlugInput(formState.slug) ?? entry.slug;
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
            const renamed = await window.zephus.renamePage(
              state.project.path,
              entry.page,
              state.project.astro.pagesDir,
              nextSlug,
            );
            if (!renamed.ok) {
              // The watcher was stopped above; re-arm it on the original path
              // so external edits to the open page keep being detected.
              if (renameIsOpenPage && state.page === entry.page) {
                await window.zephus.watchFile(state.project.path, entry.page);
              }
              setStatus("Rename failed: " + (renamed.error ?? "unknown"));
              return;
            }
            // Derive the new path from the slug + extension, never by string
            // replacing the slug inside the path (a directory segment that
            // repeats the slug would produce a wrong path).
            const dot = entry.page.lastIndexOf(".");
            const ext = dot > 0 ? entry.page.slice(dot) : ".astro";
            const pagesDir = state.project.astro.pagesDir.replace(/\/+$/, "");
            const name =
              nextSlug === "index" ? `index${ext}` : `${nextSlug}${ext}`;
            nextPage = pagesDir ? `${pagesDir}/${name}` : name;
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
          const saved = await window.zephus.writePageMeta(
            state.project.path,
            nextPage,
            state.project.astro.pagesDir,
            meta,
          );
          if (!saved.ok) {
            // The rename already succeeded on disk; if the open page was
            // renamed, the editor must follow it to the new path. Otherwise it
            // would keep pointing at the deleted old path and a later Save
            // would resurrect that file, silently duplicating the page.
            if (nextPage !== entry.page && state.page === entry.page) {
              state.page = nextPage;
              syncCurrentMeta();
              if (state.project) {
                await window.zephus
                  .watchFile(state.project.path, nextPage)
                  .catch(() => {});
              }
            }
            setStatus("Metadata save failed: " + (saved.error ?? "unknown"));
            return;
          }
          closeModal();
          await reloadPages();
          // The session document must reflect the metadata write, or the NEXT
          // page save regenerates from the stale doc and silently reverts the
          // title/label/SEO edits just made.
          if (state.page === entry.page && state.pageDocument) {
            state.pageDocument = {
              ...state.pageDocument,
              page: nextPage,
              slug: nextSlug,
              route: nextSlug === "index" ? "/" : `/${nextSlug}`,
              isHome: nextSlug === "index",
              ...meta,
            };
            syncCurrentMeta();
          }
          if (nextPage !== entry.page && state.project) {
            // The old slug's recovery draft is orphaned by the rename: its
            // content is unreachable under the old path and its home card
            // would linger forever. Clear it (the new slug has no draft yet —
            // fresh edits will create one under the new key).
            const clearedOld = await window.zephus.clearDraft(
              state.project.path,
              "page",
              entry.page,
            );
            if (!clearedOld.ok) {
              setStatus(
                "Saved page settings, but the old page's recovery draft could not be cleared: " +
                  (clearedOld.error ?? "unknown"),
              );
            }
          }
          if (state.page === entry.page) {
            // Exact match only: two pages sharing a trailing slug segment must
            // not switch the editor to the wrong page.
            state.page = nextPage;
            syncCurrentMeta();
            if (state.project) {
              // Re-register the watcher on the renamed file so external edits
              // to it keep being detected.
              await window.zephus
                .watchFile(state.project.path, nextPage)
                .catch(() => {
                  setStatus(
                    "Warning: could not watch the page for external edits.",
                  );
                });
            }
          }
          setStatus(`Saved page settings for ${entry.navLabel}.`);
        },
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
    };
    let disposeAssetBody: (() => void) | null = null;

    const renderModal = () => {
      disposeAssetBody?.();
      disposeAssetBody = renderAssetBrowserModalBody(wrap, {
        assets: modalState.assets,
        dragActive: modalState.dragActive,
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
      });
    };

    /** Summarizes where an asset is used, for the confirm prompts. */
    const describeUsage = async (webPath: string): Promise<string> => {
      const usage = await window.zephus.findAssetUsage(
        project.path,
        project.astro.pagesDir,
        webPath,
      );
      if (!usage.ok) return "";
      const places = [
        ...usage.pages.map((entry) => entry.label),
        ...usage.siteReferences,
      ];
      if (places.length === 0) return "";
      const shown = places.slice(0, 6).join(", ");
      const extra = places.length > 6 ? ` and ${places.length - 6} more` : "";
      return `${shown}${extra}`;
    };

    const renameAssetFlow = async (
      asset: AssetBrowserModalEntry,
    ): Promise<void> => {
      const currentName = asset.fileName.split("/").pop() ?? asset.fileName;
      const dotIndex = currentName.lastIndexOf(".");
      const stem = dotIndex > 0 ? currentName.slice(0, dotIndex) : currentName;
      const extension = dotIndex > 0 ? currentName.slice(dotIndex) : "";
      const usedBy = await describeUsage(asset.webPath);
      const nextName = await modalController.promptText("Rename Asset", {
        label: `New name (keeps ${extension || "the same type"})`,
        value: stem,
        confirmLabel: "Rename",
        description: usedBy
          ? `Used by: ${usedBy}. Renaming updates those references too.`
          : undefined,
      });
      if (!nextName || nextName.trim() === stem) return;

      // Repointing rewrites saved page sidecars, so unsaved edits must be settled
      // first — otherwise saving afterwards would write back the old asset path.
      if (isGlobalDirty(state) && !(await maybeResolveUnsavedWork())) {
        setStatus("Rename canceled: save or discard your changes first.");
        return;
      }

      const result = await window.zephus.renameAsset(
        project.path,
        project.astro.publicDir,
        project.astro.pagesDir,
        asset.webPath,
        nextName,
      );
      if (!result.ok || !result.webPath) {
        setStatus("Rename failed: " + (result.error ?? "unknown"));
        await refresh();
        return;
      }
      // Drop cached data-URLs for both the old and the new path so the canvas
      // re-reads the file instead of serving a stale (or wrong-file) copy.
      invalidateAssetCache(asset.webPath);
      invalidateAssetCache(result.webPath);

      const updated = result.updatedReferences ?? 0;
      // The open page and site document were changed on disk by the repoint, so
      // reload them rather than leaving the editor on a stale copy.
      await reloadSiteDocumentFromDisk();
      if (state.page) {
        await loadPage(state.page, {
          skipUnsavedGuard: true,
          skipDraftRestore: true,
          forceReload: true,
        });
      }
      await refresh();
      setStatus(
        updated > 0
          ? `Renamed asset and updated ${updated} reference(s).`
          : "Renamed asset.",
      );
    };

    const deleteAssetFlow = async (
      asset: AssetBrowserModalEntry,
    ): Promise<void> => {
      const displayName = asset.fileName.split("/").pop() ?? asset.fileName;
      const usedBy = await describeUsage(asset.webPath);
      const confirmed = await modalController.confirmDestructive(
        "Delete Asset",
        usedBy
          ? `"${displayName}" is still used by: ${usedBy}. Deleting it will leave those places pointing at a missing file. Delete anyway?`
          : `Delete "${displayName}" from this project? This removes the file from disk.`,
        "Delete Asset",
      );
      if (!confirmed) return;

      const result = await window.zephus.deleteAsset(
        project.path,
        project.astro.publicDir,
        asset.webPath,
      );
      if (!result.ok) {
        setStatus("Delete failed: " + (result.error ?? "unknown"));
        return;
      }
      // The freed name can be reclaimed by a later import; drop the cached
      // data-URL so the canvas never keeps showing the deleted file's bytes.
      invalidateAssetCache(asset.webPath);
      await refresh();
      setStatus(`Deleted ${displayName}.`);
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

    let refreshSeq = 0;
    const refresh = async (): Promise<void> => {
      const seq = ++refreshSeq;
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
      renderModal();
    };

    const handleDropPaths = async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return;
      const res = await window.zephus.importAssetPaths(
        project.path,
        project.astro.publicDir,
        paths,
      );
      if (res.errors.length > 0) {
        setStatus(`Some files failed to import: ${res.errors.join("; ")}`);
      } else {
        setStatus(`Imported ${res.imported.length} file(s).`);
      }
      await refresh();
    };

    const handleDroppedFiles = async (files: File[]): Promise<void> => {
      modalState.dragActive = false;
      renderModal();
      const paths = files
        .map((file) => {
          try {
            return window.zephus.getDroppedFilePath(file);
          } catch {
            return "";
          }
        })
        .filter(Boolean);
      await handleDropPaths(paths);
    };

    renderModal();
    void refresh();

    showModalNode(options.title ?? "Asset Browser", wrap, [
      {
        label: "Import Files",
        kind: "primary",
        onClick: async () => {
          if (!state.project) return;
          const res = await window.zephus.importAssets(
            project.path,
            project.astro.publicDir,
          );
          if (res.errors.length > 0) {
            setStatus(`Some files failed: ${res.errors.join("; ")}`);
          } else if (res.imported.length > 0) {
            setStatus(`Imported ${res.imported.length} file(s).`);
          }
          await refresh();
        },
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
