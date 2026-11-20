/**
 * Stage the Node editor backend for the Tauri resource directory.
 *
 * The packaged shell runs `dist/main/main.js` with cwd set to this tree.
 * Paths stay checkout-relative: `dist/main`, `src/main/runtime`,
 * `template-previews/dist`, `licenses.json`, and `package.json`.
 * Unit tests, source maps, and declaration files stay out. npm packages
 * that the compiled backend `require`s are copied with their production
 * dependencies. Electron imports are satisfied by the runtime shims.
 */

import { builtinModules, createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const defaultRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const SHIMMED = new Set(["electron", "electron-log", "electron-updater"]);
const builtins = new Set(builtinModules);

function isExternal(specifier) {
  if (specifier.startsWith(".") || specifier.startsWith("node:")) return false;
  const name = specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
  return !builtins.has(name);
}

function packageName(specifier) {
  return specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0];
}

function collectRequires(dir, specs) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "__tests__") continue;
      collectRequires(full, specs);
      continue;
    }
    if (!entry.name.endsWith(".js")) continue;
    const text = readFileSync(full, "utf8");
    for (const match of text.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      if (isExternal(match[2])) specs.add(packageName(match[2]));
    }
  }
}

function productionDeps(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  return Object.keys(manifest.dependencies ?? {});
}

function resolvePackageDir(resolvePackage, name) {
  let dir = dirname(resolvePackage(name));
  while (true) {
    const manifestPath = join(dir, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (manifest.name === name) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error(`Could not locate package.json for ${name}`);
    }
    dir = parent;
  }
}

function assertRelativeRequires(entry) {
  const seen = new Set();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (!file || seen.has(file)) continue;
    seen.add(file);
    if (!file.endsWith(".js")) continue;
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/require\((['"])([^'"]+)\1\)/g)) {
      const spec = match[2];
      if (!spec.startsWith(".")) continue;
      const base = resolve(dirname(file), spec);
      const resolved = [
        base,
        `${base}.js`,
        `${base}.cjs`,
        `${base}.json`,
        join(base, "index.js"),
      ].find((candidate) => existsSync(candidate));
      if (!resolved) {
        throw new Error(
          `Staged backend is missing ${spec} required by ${file}`,
        );
      }
      queue.push(resolved);
    }
  }
}

export function stageBackendResources(root = defaultRoot) {
  const mainDir = join(root, "dist", "main");
  const sharedDir = join(root, "dist", "shared");
  const runtimeDir = join(root, "src", "main", "runtime");
  const previewsDir = join(root, "template-previews", "dist");
  const dest = join(root, "src-tauri", "resources", "backend");
  const require = createRequire(join(root, "package.json"));
  const specs = new Set();
  collectRequires(mainDir, specs);
  collectRequires(sharedDir, specs);

  const needed = new Set();
  const queue = [...specs].filter((name) => !SHIMMED.has(name));
  for (const name of queue) {
    if (SHIMMED.has(name) || needed.has(name)) continue;
    const sourceDir = resolvePackageDir(require.resolve.bind(require), name);
    needed.add(name);
    for (const dep of productionDeps(sourceDir)) queue.push(dep);
  }

  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });

  const compiledFilter = (rootDir) => (source) => {
    const rel = relative(rootDir, source);
    if (!rel) return true;
    if (rel.split(sep).includes("__tests__")) return false;
    return !source.endsWith(".map") && !source.endsWith(".d.ts");
  };
  cpSync(mainDir, join(dest, "dist", "main"), {
    recursive: true,
    filter: compiledFilter(mainDir),
  });
  cpSync(sharedDir, join(dest, "dist", "shared"), {
    recursive: true,
    filter: compiledFilter(sharedDir),
  });

  const runtimeDest = join(dest, "src", "main", "runtime");
  mkdirSync(runtimeDest, { recursive: true });
  for (const entry of readdirSync(runtimeDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".cjs")) continue;
    cpSync(join(runtimeDir, entry.name), join(runtimeDest, entry.name));
  }

  cpSync(previewsDir, join(dest, "template-previews", "dist"), {
    recursive: true,
  });
  cpSync(join(root, "licenses.json"), join(dest, "licenses.json"));
  cpSync(join(root, "package.json"), join(dest, "package.json"));

  for (const name of needed) {
    const sourceDir = resolvePackageDir(require.resolve.bind(require), name);
    const packageDest = join(dest, "node_modules", name);
    cpSync(sourceDir, packageDest, {
      recursive: true,
      filter(source) {
        const rel = relative(sourceDir, source);
        return !rel.split(sep).includes("node_modules");
      },
    });
  }

  const mainJs = join(dest, "dist", "main", "main.js");
  const hook = join(dest, "src", "main", "runtime", "registerHook.cjs");
  if (!existsSync(mainJs) || !existsSync(hook)) {
    throw new Error("Staged Node backend is missing its entry files");
  }
  assertRelativeRequires(mainJs);
  return { dest, packages: [...needed].sort() };
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  try {
    const staged = stageBackendResources();
    console.log(
      `[backend] Staged ${staged.packages.length} npm packages at ${staged.dest}`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
