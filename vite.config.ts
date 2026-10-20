import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  base: "./",
  resolve: {
    alias: {
      "@shared": path.resolve("shared"),
      "@": path.resolve("src")
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome140",
    sourcemap: false
  },
  server: {
    port: 5173,
    strictPort: true
  }
});
