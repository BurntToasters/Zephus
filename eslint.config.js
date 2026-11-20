const js = require("@eslint/js");
const tseslint = require("typescript-eslint");

module.exports = tseslint.config(
  {
    ignores: [
      "dist/**",
      "release/**",
      "node_modules/**",
      "src/renderer/**/*.js",
      "src/renderer/**/*.js.map",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}", "scripts/*.{js,cjs,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_" },
      ],
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
    },
  },
  {
    files: ["scripts/**/*.{js,cjs,mjs}", "src/main/runtime/**/*.cjs"],
    languageOptions: {
      globals: {
        require: "readonly",
        module: "readonly",
        exports: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        setImmediate: "readonly",
        queueMicrotask: "readonly",
        URL: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        global: "readonly",
        structuredClone: "readonly",
      },
    },
    rules: {
      "no-var": "error",
      "prefer-const": "error",
      eqeqeq: ["error", "always", { null: "ignore" }],
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "no-control-regex": "off",
      "no-empty": "off",
      "preserve-caught-error": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["scripts/e2e-failure-suite.js"],
    rules: {
      "no-script-url": "off",
    },
  },
);
