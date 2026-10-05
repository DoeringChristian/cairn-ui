import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The built-in custom viewers: builtin-viewers/viewers/ (a folder per
  // viewer + registry.json) is copied to _dist/viewers/, where the server
  // lists and serves them (cairn.viewer.builtin_viewers_dir).
  publicDir: "builtin-viewers",
  build: {
    outDir: "./cairn_ui/_dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      // Two HTML entries sharing one /assets chunk graph: the SPA
      // (index.html → main.tsx) and the single embedded card
      // (embed.html → embed-main.tsx, served at /embed/card).
      input: {
        main: "index.html",
        embed: "embed.html",
      },
    },
  },
  server: {
    port: 5173,
    // `npm run dev` proxies /api to `cairn ui`'s default port.
    proxy: {
      "/api": "http://localhost:4301",
    },
  },
});
