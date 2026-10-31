import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, ".") } },
  test: {
    include: ["tests/unit/**/*.test.ts", "tests/integration/**/*.test.ts", "packages/*/test/**/*.test.ts"],
    environment: "node",
    setupFiles: ["tests/setup-env.ts"],
    fileParallelism: false,
  },
});
