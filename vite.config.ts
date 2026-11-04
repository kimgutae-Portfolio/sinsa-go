import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";
import { resolveSiteOrigin } from "./src/shared/site";
import { metadataPlugin } from "./scripts/branding/metadata-plugin";

export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [vue(), metadataPlugin(resolveSiteOrigin(process.env.SITE_URL || loadEnv(mode, process.cwd(), "SITE_").SITE_URL))],
  server: {
    proxy: {
      "/realtime": { target: "http://127.0.0.1:8787", ws: true },
      "/api/admin": { target: "http://127.0.0.1:8787" },
    },
  },
  preview: {
    proxy: {
      "/realtime": { target: "http://127.0.0.1:8787", ws: true },
      "/api/admin": { target: "http://127.0.0.1:8787" },
    },
  },
  build: {
    rollupOptions: {
      output: { manualChunks: { three: ["three"] } },
    },
  },
}));
