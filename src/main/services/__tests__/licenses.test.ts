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
});
