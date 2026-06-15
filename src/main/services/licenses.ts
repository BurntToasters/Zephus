import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import log from "electron-log";
import { ProductionLicenseEntry, ProductionLicensesResult } from "../types";

interface RawLicenseEntry {
  licenses?: string;
  repository?: string;
  licenseUrl?: string;
  parents?: string | string[];
}

interface LockPackageEntry {
  version?: string;
  dev?: boolean;
}

function resolveAppPath(): string {
  if (app?.getAppPath) return app.getAppPath();
  return process.cwd();
}

function splitPackageId(packageId: string): {
  name: string;
  version: string | null;
} {
  const atIndex = packageId.lastIndexOf("@");
  if (atIndex <= 0) {
    return { name: packageId, version: null };
  }
  return {
    name: packageId.slice(0, atIndex),
    version: packageId.slice(atIndex + 1) || null,
  };
}

function normalizeParents(parents: RawLicenseEntry["parents"]): string[] {
  if (Array.isArray(parents)) return parents;
  if (typeof parents === "string" && parents.trim()) {
    return parents
      .split(",")
      .map((parent) => parent.trim())
      .filter(Boolean);
  }
  return [];
}

export function licensesFilePath(appPath = resolveAppPath()): string {
  return path.join(appPath, "licenses.json");
}

export function packageLockPath(appPath = resolveAppPath()): string {
  return path.join(appPath, "package-lock.json");
}

function packageNameFromLockKey(key: string): string | null {
  const marker = "node_modules/";
  const markerIndex = key.lastIndexOf(marker);
  if (markerIndex === -1) return null;
  const pkgPath = key.slice(markerIndex + marker.length);
  const parts = pkgPath.split("/").filter(Boolean);
  if (parts.length === 0) return null;
  if (parts[0]?.startsWith("@")) {
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  }
  return parts[0] ?? null;
}

export function readProductionPackageIdsFromLock(
  filePath = packageLockPath(),
): Set<string> | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
      packages?: Record<string, LockPackageEntry>;
    };

    const allowed = new Set<string>();
    for (const [key, data] of Object.entries(parsed.packages ?? {})) {
      if (!key || data.dev || !data.version) continue;
      const name = packageNameFromLockKey(key);
      if (!name) continue;
      allowed.add(`${name}@${data.version}`);
    }
    return allowed;
  } catch (error) {
    log.warn(
      "Failed to read package-lock.json for production license filter.",
      error,
    );
    return null;
  }
}

export function parseProductionLicenses(
  raw: Record<string, RawLicenseEntry>,
): ProductionLicenseEntry[] {
  return Object.entries(raw)
    .map(([packageId, data]) => {
      const { name, version } = splitPackageId(packageId);
      return {
        packageId,
        name,
        version,
        licenses: data.licenses?.trim() || "Unknown",
        repository: data.repository?.trim() || null,
        licenseUrl: data.licenseUrl?.trim() || null,
        parents: normalizeParents(data.parents),
      };
    })
    .sort((a, b) => a.packageId.localeCompare(b.packageId));
}

export function readProductionLicenses(
  filePath = licensesFilePath(),
  lockFilePath = packageLockPath(),
): ProductionLicensesResult {
  try {
    if (!fs.existsSync(filePath)) {
      return {
        ok: false,
        entries: [],
        filePath,
        error:
          'licenses.json not found. Run "npm run licenses" to generate production license data.',
      };
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<
      string,
      RawLicenseEntry
    >;
    const allowedPackageIds = readProductionPackageIdsFromLock(lockFilePath);
    const entries = parseProductionLicenses(parsed).filter(
      (entry) => !allowedPackageIds || allowedPackageIds.has(entry.packageId),
    );

    return {
      ok: true,
      entries,
      filePath,
    };
  } catch (error) {
    log.error("Failed to read production license data.", error);
    return {
      ok: false,
      entries: [],
      filePath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
