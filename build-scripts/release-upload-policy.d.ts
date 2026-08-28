interface ReleaseUploadPolicy {
  getReleaseUploadFiles(releaseEntries: string[], releaseDir: string): string[];
  isReleaseUploadName(name: string): boolean;
}

declare const releaseUploadPolicy: ReleaseUploadPolicy;

export = releaseUploadPolicy;
