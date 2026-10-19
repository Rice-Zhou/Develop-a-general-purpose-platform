import { defineConfig } from "vite";
export default defineConfig({
  build: {
    rollupOptions: {
      external: ["mammoth", "cheerio", "pdfjs-dist/legacy/build/pdf.mjs"],
      output: { format: "cjs", entryFileNames: "parser-worker.cjs" },
    },
  },
});
