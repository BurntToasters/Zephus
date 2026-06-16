import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules", "dist", "release"],
    coverage: {
      reporter: ["text", "html", "clover", "json", "json-summary"],
    },
  },
});
