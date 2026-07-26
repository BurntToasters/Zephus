/** Short branch sync hint for Git panel / topbar (e.g. " ↑2 ↓1"). */
export function formatGitUpstreamLabel(
  ahead: number | undefined,
  behind: number | undefined,
): string {
  if (ahead == null || behind == null) return "";
  if (ahead === 0 && behind === 0) return "";
  const parts: string[] = [];
  if (ahead > 0) parts.push(`↑${ahead}`);
  if (behind > 0) parts.push(`↓${behind}`);
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function formatGitUpstreamPanelNote(
  ahead: number,
  behind: number,
): string | null {
  if (ahead === 0 && behind === 0) return null;
  if (behind > 0 && ahead > 0) {
    return `Remote is ${behind} commit(s) ahead and you have ${ahead} local commit(s) to push. Pull (fast-forward) or push as needed.`;
  }
  if (behind > 0) {
    return `Remote has ${behind} commit(s) you can fast-forward pull.`;
  }
  return `You have ${ahead} local commit(s) to push.`;
}
