import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    browser: {
      enabled: false,
    },
  },
  esbuild: {
    target: "esnext",
  },
  resolve: {
    extensions: [".ts", ".js", ".json"],
  },
});
