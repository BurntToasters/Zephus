/**
 * Copy for unsaved-work confirmation modals (page + site dirty summaries).
 */

export interface UnsavedWorkSummaryInput {
  pageDirty: boolean;
  pageChangeSummary: string[];
  /** Used when page is dirty but no tracked labels exist. */
  pageFallbackLabel: string;
  siteDirty: boolean;
  siteChangeSummary: string[];
  siteFallbackLabel?: string;
}

export function collectUnsavedWorkSummaryLines(
  input: UnsavedWorkSummaryInput,
): string[] {
  const siteFallback =
    input.siteFallbackLabel ?? "Unsaved site shell or design edits";
  const pageItems = input.pageChangeSummary.length
    ? input.pageChangeSummary
    : input.pageDirty
      ? [input.pageFallbackLabel]
      : [];
  const siteItems = input.siteChangeSummary.length
    ? input.siteChangeSummary
    : input.siteDirty
      ? [siteFallback]
      : [];
  return [...pageItems, ...siteItems];
}
