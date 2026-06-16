import * as path from "path";

export function normalizeProjectRelativeDir(
  value: string,
  fallback: string,
): string {
  const raw = (typeof value === "string" && value.trim()) || fallback;
  if (path.isAbsolute(raw) || path.win32.isAbsolute(raw)) return fallback;

  const slashPath = raw.replace(/\\/g, "/").replace(/^\.\//, "");
  if (path.posix.isAbsolute(slashPath)) return fallback;

  const normalized = path.posix.normalize(slashPath).replace(/\/+$/, "");
  if (
    !normalized ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return fallback;
  }
  return normalized;
}

export function resolveProjectRelativeDir(
  projectPath: string,
  value: string,
  fallback: string,
): { relative: string; absolute: string } {
  const root = path.resolve(projectPath);
  const relative = normalizeProjectRelativeDir(value, fallback);
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(root + path.sep)) {
    const safeFallback = normalizeProjectRelativeDir(fallback, ".");
    return {
      relative: safeFallback,
      absolute: path.resolve(root, safeFallback),
    };
  }
  return { relative, absolute };
}
