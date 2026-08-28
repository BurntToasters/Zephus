import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  parseProductionLicenses,
  readProductionPackageIdsFromLock,
  readProductionLicenses,
} from "../licenses";

describe("parseProductionLicenses", () => {
  it("splits package ids and normalizes fields", () => {
    const entries = parseProductionLicenses({
      "@astrojs/check@0.9.4": {
        licenses: "MIT",
        repository: "https://github.com/withastro/astro",
        licenseUrl: "https://example.com/license",
        parents: "zephus, astro",
      },
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      packageId: "@astrojs/check@0.9.4",
      name: "@astrojs/check",
      version: "0.9.4",
      licenses: "MIT",
      repository: "https://github.com/withastro/astro",
      licenseUrl: "https://example.com/license",
      parents: ["zephus", "astro"],
    });
  });

  it("handles ids without an @ separator", () => {
    const entries = parseProductionLicenses({
      plainpkg: {
        licenseUrl: "https://x",
        licenses: "MIT",
        repository: "",
      },
    });
    expect(entries[0]!.name).toBe("plainpkg");
    expect(entries[0]!.version).toBeNull();
  });

  it("reads the default licenses file location", () => {
    // No explicit path: the default (cwd-based) location is used. The repo
    // root may or may not have a generated licenses.json (CI / fresh clone) —
    // either outcome is valid, but the result must always be well-formed.
    const result = readProductionLicenses();
    expect(result.filePath).toBeTruthy();
    if (result.ok) {
      expect(Array.isArray(result.entries)).toBe(true);
    } else {
      expect(result.error).toContain("licenses.json not found");
    }
  });
});

describe("readProductionLicenses", () => {
  it("reads non-dev package ids from package-lock", () => {
    const file = path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "zephus-lock-")),
      "package-lock.json",
    );
    fs.writeFileSync(
      file,
      JSON.stringify({
        packages: {
          "": {},
          "node_modules/electron-log": { version: "5.4.4" },
          "node_modules/astro": { version: "5.18.2", dev: true },
          "node_modules/@sindresorhus/is": { version: "7.1.0" },
        },
      }),
      "utf8",
    );

    const ids = readProductionPackageIdsFromLock(file);
    expect(ids?.has("electron-log@5.4.4")).toBe(true);
    expect(ids?.has("@sindresorhus/is@7.1.0")).toBe(true);
    expect(ids?.has("astro@5.18.2")).toBe(false);
  });

  it("returns null (no filter) when the lockfile cannot be read", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-lockdir-"));
    // A directory where the lockfile should be: readFileSync throws.
    expect(readProductionPackageIdsFromLock(dir)).toBeNull();
    expect(
      readProductionPackageIdsFromLock(path.join(dir, "missing")),
    ).toBeNull();
  });

  it("reports failure when licenses.json cannot be parsed", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-licbad-"));
    // A directory where licenses.json should be: JSON.parse throws.
    const result = readProductionLicenses(root);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it("filters entries against the production allowlist", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-licfil-"));
    const file = path.join(root, "licenses.json");
    const lock = path.join(root, "package-lock.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        "astro@5.0.0": {
          licenseUrl: "https://x",
          licenses: "MIT",
          repository: "",
        },
        "esbuild@0.28.0": {
          licenseUrl: "https://y",
          licenses: "MIT",
          repository: "",
          parents: ["bundled in renderer"],
        },
      }),
    );
    fs.writeFileSync(
      lock,
      JSON.stringify({
        packages: { "node_modules/astro": { version: "5.0.0" } },
      }),
    );
    const result = readProductionLicenses(file, lock);
    expect(result.ok).toBe(true);
    const ids = result.entries.map((e) => e.packageId).sort();
    // astro is in the allowlist; esbuild is kept via the bundled marker even
    // though it is absent from the allowlist.
    expect(ids).toEqual(["astro@5.0.0", "esbuild@0.28.0"]);
  });

  it("returns helpful error when licenses.json missing", () => {
    const missing = path.join(os.tmpdir(), "definitely-missing-licenses.json");
    const result = readProductionLicenses(missing);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("npm run licenses");
  });

  it("reads production license entries from json file", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-licenses-"));
    const file = path.join(root, "licenses.json");
    const lock = path.join(root, "package-lock.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        "astro@5.0.0": {
          licenses: "MIT",
          repository: "https://github.com/withastro/astro",
          licenseUrl: "https://github.com/withastro/astro/raw/main/LICENSE",
          parents: "zephus",
        },
        "electron-log@5.4.4": {
          licenses: "MIT",
          repository: "https://github.com/megahertz/electron-log",
          licenseUrl:
            "https://github.com/megahertz/electron-log/raw/master/LICENSE",
          parents: "zephus",
        },
      }),
      "utf8",
    );
    fs.writeFileSync(
      lock,
      JSON.stringify({
        packages: {
          "": {},
          "node_modules/astro": { version: "5.0.0", dev: true },
          "node_modules/electron-log": { version: "5.4.4" },
        },
      }),
      "utf8",
    );

    const result = readProductionLicenses(file, lock);
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      packageId: "electron-log@5.4.4",
      name: "electron-log",
      version: "5.4.4",
      licenses: "MIT",
    });
  });

  it("keeps bundled-renderer entries even when they are dev deps", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-licenses-"));
    const file = path.join(root, "licenses.json");
    const lock = path.join(root, "package-lock.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        "codemirror@6.0.2": {
          licenses: "MIT",
          repository: "https://github.com/codemirror/dev",
          licenseUrl: "https://example.com/mit",
          parents: "zephus (bundled in renderer)",
        },
      }),
      "utf8",
    );
    fs.writeFileSync(
      lock,
      JSON.stringify({
        packages: {
          "": {},
          "node_modules/codemirror": { version: "6.0.2", dev: true },
        },
      }),
      "utf8",
    );

    const result = readProductionLicenses(file, lock);
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.packageId).toBe("codemirror@6.0.2");
  });

  it("shows everything when the lockfile cannot filter (no packages map)", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "zephus-licenses-"));
    const file = path.join(root, "licenses.json");
    const lock = path.join(root, "package-lock.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        "astro@5.0.0": {
          licenses: "MIT",
          repository: "https://github.com/withastro/astro",
          parents: "zephus",
        },
      }),
      "utf8",
    );
    // lockfileVersion 1 style: no packages map at all.
    fs.writeFileSync(
      lock,
      JSON.stringify({ name: "old", version: "1.0.0", dependencies: {} }),
      "utf8",
    );

    const result = readProductionLicenses(file, lock);
    expect(result.ok).toBe(true);
    expect(result.entries).toHaveLength(1);
  });

  it("drops absolute filesystem paths from licenseUrl", () => {
    const entries = parseProductionLicenses({
      "astro@5.0.0": {
        licenses: "MIT",
        repository: "https://github.com/withastro/astro",
        licenseUrl: "/Users/dev/node_modules/astro/LICENSE",
        parents: "zephus",
      },
    });
    expect(entries[0]!.licenseUrl).toBeNull();
  });
});
