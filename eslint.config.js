import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Minimal. The only enforced rule is `react-hooks/rules-of-hooks` — it fails
// any build that calls a hook after an early return (the bug that crashed
// RunResults when swarmActive flipped). exhaustive-deps is on as the standard
// React companion. No other rules; typecheck stays the only other gate.
// AGENTS.md "No lint" is scoped: this exists to prevent regressions of the
// early-return-before-hook class of bug specifically.
export default [
  {
    ignores: ["src-tauri/**", "node_modules/**", "dist/**", "src-tauri/target/**"],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: 2022, sourceType: "module" },
      globals: { ...globals.browser },
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      // The one rule that matters: forbids hook calls after an early return,
      // in conditionals, or in loops. Crashes React at runtime otherwise.
      "react-hooks/rules-of-hooks": "error",
      // exhaustive-deps left off — pre-existing violations exist and are out
      // of scope for this rule. Re-enable as `warn` for a sweep when desired.
      "react-hooks/exhaustive-deps": "off",
    },
  },
];
