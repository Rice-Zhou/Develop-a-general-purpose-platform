import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["electron", "better-sqlite3", "koffi"],
      output: { format: "cjs", entryFileNames: "main.cjs" },
    },
  },
});
