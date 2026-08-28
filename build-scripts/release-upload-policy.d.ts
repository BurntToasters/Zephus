interface ReleaseUploadPolicy {
  getReleaseUploadFiles(releaseEntries: string[], releaseDir: string): string[];
  isReleaseUploadName(name: string): boolean;
  releaseSourceFailures(input: {
    head: string;
    targetCommit: string;
    worktreeStatus: string;
    existingTagCommit: string;
  }): string[];
  selectMatchingDraft(
    releases: Array<{
      tag_name?: string;
      draft?: boolean;
      [key: string]: unknown;
    }>,
    tagName: string,
  ): {
    draft: Record<string, unknown> | null;
    published: Record<string, unknown> | null;
  };
}

declare const releaseUploadPolicy: ReleaseUploadPolicy;

export = releaseUploadPolicy;
