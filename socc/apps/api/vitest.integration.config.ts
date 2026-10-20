import { defineConfig } from "vitest/config";
import swc from "unplugin-swc";

export default defineConfig({
  plugins: [
    swc.vite({
      jsc: {
        parser: { syntax: "typescript", decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: "es2022",
      },
      module: { type: "es6" },
    }),
  ],
  test: {
    include: ["test/integration/**/*.spec.ts"],
    environment: "node",
    pool: "forks",
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
    setupFiles: ["./vitest.setup.ts"],
    globalSetup: ["./test/integration/global-setup.ts"],
  },
});
