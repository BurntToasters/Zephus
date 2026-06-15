// Bundles the preload script (src/main/preload.ts) into a single CJS file that
// Electron's sandboxed preload loader can require. The sandboxed loader only
// supports require('electron') natively — any relative imports must be inlined.
const esbuild = require("esbuild");
const path = require("path");

const root = path.resolve(__dirname, "..");
const watchMode = process.argv.includes("--watch");

function buildOptions() {
  return {
    entryPoints: [path.join(root, "src", "main", "preload.ts")],
    outfile: path.join(root, "dist", "main", "preload.js"),
    bundle: true,
    format: "cjs",
    platform: "node",
    target: "es2020",
    sourcemap: false,
    external: ["electron"],
    legalComments: "none",
    logLevel: "info",
  };
}

async function main() {
  if (!watchMode) {
    await esbuild.build(buildOptions());
    console.log("Preload bundle written to dist/main/preload.js");
    return;
  }

  const context = await esbuild.context(buildOptions());
  await context.watch();
  console.log("Watching preload bundle...");

  const shutdown = async () => {
    await context.dispose();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
