import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "dist/**", "next-env.d.ts", "public/**", "extension/**"]),
  {
    // Mandate-scoped tables must be read through lib/db/scoped.ts (SPEC section 9).
    files: ["app/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "components/**/*.{ts,tsx}"],
    ignores: ["lib/db/**"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{ name: "@/db", importNames: ["getDb"], message: "Use lib/db/scoped.ts for data access." }],
      }],
    },
  },
]);

export default eslintConfig;
