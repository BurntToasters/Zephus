import { windowsPackageVersionFromSemver } from "./sync-version-helpers.mjs";

const version = process.argv[2]?.trim();
if (!version) {
  console.error(
    "Usage: node scripts/print-windows-package-version.mjs <semver>",
  );
  process.exitCode = 1;
} else {
  try {
    console.log(windowsPackageVersionFromSemver(version));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
