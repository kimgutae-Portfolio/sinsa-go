import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  base: "./",
  plugins: [vue()],
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
});
