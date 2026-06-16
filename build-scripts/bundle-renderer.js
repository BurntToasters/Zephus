// Bundles the renderer entry (src/renderer/zephusEngine.ts) and its npm
// dependencies (CodeMirror, etc.) into a single browser IIFE that the
// sandboxed renderer can load via a plain <script> tag.
const esbuild = require("esbuild");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

// Records which node_modules packages get inlined into the shipped bundle, so
// crawl-licenses.js can attribute them (they ship inside zephusEngine.js even
// though npm classifies them as devDependencies). Kept in the OS temp dir so it
// is never committed or packaged into the app.
const META_OUT = path.join(os.tmpdir(), "zephus-renderer-meta.json");

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
};

function writeMeta(metafile) {
  if (!metafile) return;
  fs.mkdirSync(path.dirname(META_OUT), { recursive: true });
  fs.writeFileSync(META_OUT, JSON.stringify(metafile));
}

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Renderer bundler watching for changes…");
  } else {
    const result = await esbuild.build(options);
    writeMeta(result.metafile);
    console.log("Renderer bundle written to src/renderer/zephusEngine.js");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
