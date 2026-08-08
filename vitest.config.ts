import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      electron: path.resolve(rootDir, "src/test/mocks/electron.ts"),
      "electron-log": path.resolve(rootDir, "src/test/mocks/electron-log.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "release"],
    // Real fs.watch delivery (watch.test.ts) is unreliable under parallel
    // file execution — the OS can drop directory-watch events under load.
    // Serializing files costs a few seconds and makes the watcher tests
    // deterministic.
    fileParallelism: false,
    coverage: {
      reporter: ["text", "html", "clover", "json", "json-summary"],
    },
  },
});
