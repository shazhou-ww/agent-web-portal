import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// API URL configuration:
//   1. --url <endpoint> flag takes highest priority
//   2. PORT_IMAGE_WORKSHOP_API env var sets the port
//   3. Falls back to port 8802
const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
const defaultPort = process.env.PORT_IMAGE_WORKSHOP_API ?? "8802";
let apiUrl = `http://localhost:${defaultPort}`;

if (urlIndex !== -1 && args[urlIndex + 1]) {
  apiUrl = args[urlIndex + 1];
}

console.log(`[vite] Proxying API requests to: ${apiUrl}`);

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  base: "/",
  // Polyfill Node.js globals for browser (required by amazon-cognito-identity-js)
  define: {
    global: "globalThis",
  },
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: true,
  },
  server: {
    port: 5174,
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
        // Keep the /api prefix - backend expects it
      },
    },
  },
});
