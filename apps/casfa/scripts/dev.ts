/**
 * CASFA - Development Server
 *
 * Starts both backend and frontend development servers in parallel.
 *
 * Usage:
 *   bun run dev              # Start both backend and frontend
 *   bun run dev:backend      # Start only backend
 *   bun run dev:frontend     # Start only frontend
 *
 * Environment variables (in root .env):
 *   PORT_CASFA_WEBUI  - Frontend port (default: 5550)
 *   PORT_CASFA_API    - Backend port (default: 3550)
 */

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { type Subprocess, spawn } from "bun";

const ROOT_DIR = join(import.meta.dir, "..");
const REPO_ROOT = join(ROOT_DIR, "../..");

// Track which directory each env var came from (for relative path resolution)
const envVarSourceDir = new Map<string, string>();

// Load .env files (repo root first, then package root - later overrides earlier)
function loadEnvFile(dir: string): void {
  const envPath = join(dir, ".env");
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, "utf-8");
  for (const line of content.split("\n")) {
    const t = line.trim();
    if (t && !t.startsWith("#")) {
      const eq = t.indexOf("=");
      if (eq > 0) {
        const key = t.slice(0, eq).trim();
        const value = t
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
        process.env[key] = value;
        envVarSourceDir.set(key, dir);
      }
    }
  }
}

loadEnvFile(REPO_ROOT);
loadEnvFile(ROOT_DIR);

// Port configuration from environment
const PORT_WEBUI = process.env.PORT_CASFA_WEBUI || "5550";
const PORT_API = process.env.PORT_CASFA_API || "3550";

// Resolve CAS_STORAGE_DIR: if relative path, resolve relative to the .env file that defined it
function resolveCasStorageDir(): string {
  const envValue = process.env.CAS_STORAGE_DIR;
  if (!envValue) {
    // Default: .local-cas-storage in apps/casfa
    return join(ROOT_DIR, ".local-cas-storage");
  }
  if (isAbsolute(envValue)) {
    return envValue;
  }
  // Relative path: resolve relative to the .env file's directory
  const sourceDir = envVarSourceDir.get("CAS_STORAGE_DIR") || ROOT_DIR;
  return join(sourceDir, envValue);
}
const CAS_STORAGE_DIR = resolveCasStorageDir();

interface ProcessInfo {
  name: string;
  process: Subprocess;
  color: string;
}

const processes: ProcessInfo[] = [];

function colorize(text: string, color: string): string {
  const colors: Record<string, string> = {
    cyan: "\x1b[36m",
    magenta: "\x1b[35m",
    yellow: "\x1b[33m",
    green: "\x1b[32m",
    reset: "\x1b[0m",
  };
  return `${colors[color] || ""}${text}${colors.reset}`;
}

async function startBackend(): Promise<Subprocess> {
  console.log(colorize(`[backend] Starting development server on port ${PORT_API}...`, "cyan"));
  console.log(colorize(`[backend] CAS storage directory: ${CAS_STORAGE_DIR}`, "cyan"));

  const proc = spawn({
    cmd: ["bun", "run", "backend/server.ts"],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      PORT: PORT_API,
      CAS_STORAGE_DIR,
    },
  });

  return proc;
}

async function startFrontend(): Promise<Subprocess> {
  console.log(colorize(`[frontend] Starting Vite development server on port ${PORT_WEBUI}...`, "magenta"));

  const proc = spawn({
    cmd: ["bun", "run", "vite", "--config", "frontend/vite.config.ts", "--port", PORT_WEBUI],
    cwd: ROOT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  });

  return proc;
}

async function cleanup(): Promise<void> {
  console.log(`\n${colorize("Shutting down...", "yellow")}`);

  for (const { name, process } of processes) {
    console.log(colorize(`[${name}] Stopping...`, "yellow"));
    process.kill();
  }

  await new Promise((resolve) => setTimeout(resolve, 500));
  process.exit(0);
}

async function main(): Promise<void> {
  console.log();
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         CASFA - Development Environment                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(colorize("Starting development servers...", "green"));
  console.log();

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    const [backendProc, frontendProc] = await Promise.all([startBackend(), startFrontend()]);

    processes.push(
      { name: "backend", process: backendProc, color: "cyan" },
      { name: "frontend", process: frontendProc, color: "magenta" }
    );

    console.log();
    console.log(colorize("Development servers started:", "green"));
    console.log(colorize(`  Backend:  http://localhost:${PORT_API}`, "cyan"));
    console.log(colorize(`  Frontend: http://localhost:${PORT_WEBUI}`, "magenta"));
    console.log();
    console.log(colorize("Press Ctrl+C to stop all servers", "yellow"));
    console.log();

    await Promise.race([backendProc.exited, frontendProc.exited]);

    await cleanup();
  } catch (error) {
    console.error("Failed to start development servers:", error);
    await cleanup();
    process.exit(1);
  }
}

main();
