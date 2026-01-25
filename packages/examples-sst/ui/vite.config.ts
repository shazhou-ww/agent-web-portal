import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: "/ui/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/basic": "http://localhost:3000",
      "/ecommerce": "http://localhost:3000",
      "/jsonata": "http://localhost:3000",
      "/blob": "http://localhost:3000",
    },
  },
});
