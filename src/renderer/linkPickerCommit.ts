import { safeUrl } from "../shared/renderHelpers";

export type LinkPickerCommitKind =
  "page" | "url" | "email" | "phone" | "anchor";

export interface LinkPickerDraft {
  kind: LinkPickerCommitKind;
  pageValue: string;
  rawValue: string;
  rawEdited: boolean;
  current: string;
}

/** The address Use Link would apply. Empty means the link is cleared. */
export function linkPickerHref(draft: LinkPickerDraft): string {
  const raw = draft.rawValue.trim();
  let href = draft.pageValue;
  if (draft.kind === "email") href = raw ? `mailto:${raw}` : "";
  else if (draft.kind === "phone") href = raw ? `tel:${raw}` : "";
  else if (draft.kind === "anchor")
    href = raw ? `#${raw.replace(/^#/, "")}` : "";
  else if (draft.kind === "url") {
    href = raw || (!draft.rawEdited ? draft.current.trim() : "");
  } else if (draft.kind === "page" && !href && draft.current.startsWith("/"))
    href = draft.current;
  else if (
    !href &&
    !draft.rawEdited &&
    draft.current.trim() &&
    draft.kind !== "page"
  ) {
    href = draft.current.trim();
  }
  return href;
}

/**
 * A finished address the editor must not store. Empty is allowed so the user
 * can clear a link. javascript:, vbscript:, data:, and file: are not.
 */
export function linkPickerProblem(href: string): string {
  if (!href.trim()) return "";
  if (!safeUrl(href)) return "That link type is not allowed.";
  return "";
}
