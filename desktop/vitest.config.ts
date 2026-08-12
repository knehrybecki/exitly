import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@hub": path.resolve(__dirname, "src/hub"),
      "@shared": path.resolve(__dirname, "src/shared"),
    },
  },
});
