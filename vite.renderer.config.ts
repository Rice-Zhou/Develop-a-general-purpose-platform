import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
export default defineConfig({
  root: "apps/desktop",
  base: "./",
  plugins: [react()],
  build: { outDir: resolve(process.cwd(), ".vite/renderer/main_window") },
  server: { host: "127.0.0.1" },
});
