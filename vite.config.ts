import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
