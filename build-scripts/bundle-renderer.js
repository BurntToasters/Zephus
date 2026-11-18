// Bundles the renderer entry (src/renderer/zephusEngine.ts) and its npm
// dependencies (CodeMirror, etc.) into a single browser IIFE that the
// sandboxed renderer can load via a plain <script> tag.
const esbuild = require("esbuild");
const { solidPlugin } = require("esbuild-plugin-solid");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");
const smoke = process.argv.includes("--smoke");

// Records which node_modules packages get inlined into the shipped bundle so
// crawl-licenses.js can attribute them. A repo-local cache is deterministic,
// excluded from packaging, and removed by dist-tools clean; a fixed os.tmpdir
// file could survive another checkout/version and silently misattribute licenses.
const META_OUT = path.join(root, ".cache", "zephus", "renderer-meta.json");

// Production bundles redirect the smoke harness to a no-op stub: the renderer
// only loads it under main.ts's ?smoke=1 dev query, so shipping ~27KB of test
// code would be dead weight. smoke-runtime.js rebuilds with --smoke instead.
const smokeStubPlugin = {
  name: "zephus-smoke-stub",
  setup(build) {
    if (smoke) return;
    build.onResolve({ filter: /editorSmoke$/ }, () => ({
      path: path.join(root, "src", "renderer", "editorSmokeStub.ts"),
    }));
  },
};

const options = {
  entryPoints: [path.join(root, "src", "renderer", "zephusEngine.ts")],
  outfile: path.join(root, "src", "renderer", "zephusEngine.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  legalComments: "none",
  metafile: true,
  logLevel: "info",
  plugins: [smokeStubPlugin, solidPlugin()],
};

function writeMeta(metafile) {
  if (!metafile) return;
  fs.mkdirSync(path.dirname(META_OUT), { recursive: true });
  const temporary = `${META_OUT}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(metafile));
    fs.renameSync(temporary, META_OUT);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// Guards against a "success" that produced no usable artifact (e.g. an esbuild
// resolve that emitted nothing): assert the outfile exists and is non-empty.
function verifyOutput(outfile) {
  let stat;
  try {
    stat = fs.statSync(outfile);
  } catch {
    throw new Error(`Expected bundle output missing: ${outfile}`);
  }
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Bundle output is empty: ${outfile}`);
  }
}

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Renderer bundler watching for changes…");
  } else {
    const result = await esbuild.build(options);
    writeMeta(result.metafile);
    verifyOutput(options.outfile);
    console.log("Renderer bundle written to src/renderer/zephusEngine.js");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
