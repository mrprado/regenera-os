import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: "cloudflare:workers", replacement: fileURLToPath(new URL("./tests/helpers/cloudflare-workers-stub.ts", import.meta.url)) },
      { find: /^@\//, replacement: root },
    ],
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    // Each file boots its own workerd; keep it sequential to stay light on Windows.
    fileParallelism: false,
  },
});
