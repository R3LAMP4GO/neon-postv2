import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  eslint.configs.recommended,
  {
    files: ["src/**/*.ts"],
    extends: tseslint.configs.recommended,
    languageOptions: {
      parserOptions: {
        project: "./tsconfig.json",
      },
      globals: {
        // Node.js globals
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        // Electron globals
        Electron: "readonly",
        // Browser globals (for code passed to page.evaluate)
        window: "readonly",
        document: "readonly",
        fetch: "readonly",
        HTMLElement: "readonly",
        Element: "readonly",
        Node: "readonly",
        NodeList: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-require-imports": "warn",
      "no-unused-vars": "off",
      "no-case-declarations": "off",
    },
  },
  {
    files: ["tests/**/*.ts"],
    extends: tseslint.configs.recommended,
    languageOptions: {
      parserOptions: {
        project: null, // Tests don't use project references
      },
      globals: {
        // Node.js globals
        console: "readonly",
        process: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        module: "readonly",
        require: "readonly",
        exports: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearTimeout: "readonly",
        clearInterval: "readonly",
        // Node.js globals for tests
        AbortController: "readonly",
        URLSearchParams: "readonly",
        NodeJS: "readonly",
        // Vitest globals
        global: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
        test: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "off", // Allow any in tests for mocking
      "@typescript-eslint/no-require-imports": "off",
      "no-unused-vars": "off",
    },
  },
  {
    ignores: ["dist/**", "node_modules/**", "ui/**"],
  },
);
