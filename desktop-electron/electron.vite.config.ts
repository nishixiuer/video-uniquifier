import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-electron",
      lib: {
        entry: "src/main.ts",
        formats: ["cjs"],
        fileName: () => "main.cjs",
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist-preload",
      lib: {
        entry: "src/preload.ts",
        formats: ["cjs"],
        fileName: () => "preload.cjs",
      },
    },
  },
  renderer: {
    root: ".",
    build: { outDir: "dist", rollupOptions: { input: "index.html" } },
    resolve: { alias: { "@": resolve("src") } },
    plugins: [react(), tailwindcss()],
  },
});
