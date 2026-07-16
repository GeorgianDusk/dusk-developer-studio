import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

const ignores = [
  "node_modules/**",
  "dist/**",
  "**/dist/**",
  "coverage/**",
  "playwright-report/**",
  "test-results/**",
  "tmp/**",
  ".generated/**",
  ".local-agent/**",
  "packages/templates/foundry-counter-dusk-evm/lib/**",
  "packages/templates/foundry-counter-dusk-evm/out/**"
];

const nodeGlobals = {
  console: "readonly",
  process: "readonly"
};

export default [
  js.configs.recommended,
  { ignores },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: nodeGlobals
    }
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true }
      },
      globals: {
        ...nodeGlobals,
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        localStorage: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Blob: "readonly",
        Buffer: "readonly",
        setTimeout: "readonly"
      }
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooks
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "no-unused-vars": "off",
      "no-undef": "off",
      "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
      "@typescript-eslint/no-explicit-any": "warn"
    }
  }
];
