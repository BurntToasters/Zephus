/**
 * A canvas or inspector image may only point at a project file. Anything else
 * is either blocked by img-src (a broken icon) or same-origin and fetched
 * from the editor itself. Query, hash, and dot segments are not asset paths.
 */
export function isProjectAssetPath(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//")) return false;
  if (
    value.includes("\\") ||
    value.includes("\0") ||
    value.includes("?") ||
    value.includes("#")
  ) {
    return false;
  }
  const segments = value.slice(1).split("/");
  if (segments.length === 0) return false;
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return false;
    }
    if (
      !decoded ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\") ||
      decoded.includes("\0")
    ) {
      return false;
    }
  }
  return true;
}

/** An inspector or canvas preview may only paint a data image. */
export function isAcceptedImageDataUrl(value: string): boolean {
  return /^data:image\/[a-z0-9.+-]+(?:;|,)/i.test(value.trim());
}
