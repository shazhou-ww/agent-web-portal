import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Port configuration from environment variables
const webUIPort = parseInt(process.env.PORT_CASFA_WEBUI ?? "5550", 10);
const apiPort = process.env.PORT_CASFA_API ?? "3550";

// API URL configuration:
//   1. --url <endpoint> flag takes highest priority
//   2. PORT_CASFA_API env var sets the port
//   3. Falls back to port 3550
const args = process.argv.slice(2);
const urlIndex = args.indexOf("--url");
let apiUrl = `http://localhost:${apiPort}`;

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
    port: webUIPort,
    proxy: {
      "/api": {
        target: apiUrl,
        changeOrigin: true,
        // Keep the /api prefix - backend expects it
      },
      "/cas": {
        target: apiUrl,
        changeOrigin: true,
      },
    },
  },
});
