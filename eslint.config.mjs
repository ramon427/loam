import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

const PACKAGES = ["shared", "storage", "transfer"];

/** One `no-restricted-imports` per file group: a later config would replace an earlier one. */
const restrictImports = (...patterns) => ({
  "no-restricted-imports": ["error", { patterns }],
});

const otherPackagesByAlias = {
  group: ["**/packages/**", ...PACKAGES.map((name) => `**/${name}/src/**`)],
  message: "Import another package as @loam/<package>/<path>.",
};

export default tseslint.config(
  ...PACKAGES.map((name) => ({
    files: [`packages/${name}/src/**/*.{ts,tsx}`],
    rules: restrictImports(
      {
        group: ["**/apps/**", "electron", "react", "react-dom"],
        message: "Shared models, storage, and format conversions cannot depend on the app.",
      },
      {
        group: [`@loam/${name}/*`],
        message: "Import this package's own files by relative path.",
      },
      otherPackagesByAlias,
    ),
  })),
  {
    files: ["apps/desktop/src/renderer/**/*.{ts,tsx}"],
    rules: restrictImports(
      {
        group: ["**/main/**", "**/preload/**", "electron", "node:*", "@loam/storage/*"],
        message: "The window reaches the main process and its storage only through window.loam.",
      },
      otherPackagesByAlias,
    ),
  },
  {
    files: ["apps/desktop/src/{main,preload}/**/*.ts"],
    rules: restrictImports(
      { group: ["**/renderer/**"], message: "The main process cannot import window code." },
      otherPackagesByAlias,
    ),
  },
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/dist-electron/**",
      "**/dist-renderer/**",
      "**/release/**",
      "coverage/**",
      "tmp/**",
      "**/.wrangler/**",
      // Built by examples/plugins/build.mjs.
      "examples/plugins/*/main.js",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs.flat["recommended-latest"] ?? reactHooks.configs.flat.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "react-hooks/set-state-in-effect": "off",
      // Sanitizers strip control characters on purpose.
      "no-control-regex": "off",
      // Underscore-prefixed names mark intentionally unused conformance arguments.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
    },
  },
  {
    // Playwright fixtures take `{}` first and hand values on with `use`, which isn't React's.
    files: ["e2e/**/*.ts"],
    rules: { "no-empty-pattern": "off", "react-hooks/rules-of-hooks": "off" },
  },
);
