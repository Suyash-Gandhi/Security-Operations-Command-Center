import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      "**/*.d.ts",
      "apps/api/prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // consistent-type-imports is intentionally NOT enabled: NestJS relies
      // on emitDecoratorMetadata, which needs constructor-injected classes
      // imported as runtime values (a type-only import makes
      // design:paramtypes undefined and breaks dependency injection).
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
  {
    files: ["**/prisma/seed.ts"],
    rules: {
      "no-console": "off",
    },
  },
);
