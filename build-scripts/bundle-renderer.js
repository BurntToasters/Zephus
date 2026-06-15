// Bundles the renderer entry (src/renderer/zephusEngine.ts) and its npm
// dependencies (CodeMirror, etc.) into a single browser IIFE that the
// sandboxed renderer can load via a plain <script> tag.
const esbuild = require("esbuild");
const path = require("path");

const root = path.resolve(__dirname, "..");
const watch = process.argv.includes("--watch");

const options = {
  entryPoints: [path.join(root, "src", "renderer", "zephusEngine.ts")],
  outfile: path.join(root, "src", "renderer", "zephusEngine.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  sourcemap: false,
  legalComments: "none",
  logLevel: "info",
};

async function run() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log("Renderer bundler watching for changes…");
  } else {
    await esbuild.build(options);
    console.log("Renderer bundle written to src/renderer/zephusEngine.js");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
