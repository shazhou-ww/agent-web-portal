/**
 * CASFA - Full Stack Deploy Script
 *
 * Deploys both backend (SAM) and frontend (S3/CloudFront) in sequence.
 * References shared auth stack (awp-auth) for Cognito User Pool.
 *
 * Usage:
 *   bun run deploy              # Deploy everything
 *   bun run deploy:backend      # Deploy only backend (SAM)
 *   bun run deploy:frontend     # Deploy only frontend (S3)
 *
 * Optional .env variables:
 *   AUTH_STACK_NAME          (default: awp-auth) - shared auth stack name
 *   CASFA_CALLBACK_BASE_URL  - production UI base URL (e.g. https://casfa.awp.shazhou.me)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

const ROOT_DIR = join(import.meta.dir, "..");
const REPO_ROOT = join(ROOT_DIR, "../..");

// Load .env files
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
      }
    }
  }
}

// Load repo root first, then package root (later overrides earlier)
loadEnvFile(REPO_ROOT);
loadEnvFile(ROOT_DIR);

/**
 * Build parameter overrides for SAM deploy from environment variables
 */
function buildParameterOverrides(): string[] {
  const overrides: string[] = [];

  // Auth stack name (defaults to awp-auth)
  const authStackName = process.env.AUTH_STACK_NAME || "awp-auth";
  overrides.push(`AuthStackName=${authStackName}`);

  // Callback base URL for production (CASFA-specific or fallback)
  const callbackBaseUrl =
    process.env.CASFA_CALLBACK_BASE_URL || process.env.CALLBACK_BASE_URL || "";
  if (callbackBaseUrl) {
    overrides.push(`CallbackBaseUrl=${callbackBaseUrl}`);
  }

  return overrides;
}

async function deployBackend(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Deploying Backend (SAM)");
  console.log("=".repeat(60));
  console.log();

  console.log("Building backend...");
  await $`bun run build:backend`.cwd(ROOT_DIR);
  console.log();

  console.log("Running SAM build...");
  await $`sam build`.cwd(ROOT_DIR);
  console.log();

  // Build parameter overrides from .env
  const overrides = buildParameterOverrides();

  console.log("Running SAM deploy...");
  const overridesStr = overrides.join(" ");
  console.log(`  (referencing shared auth stack: ${process.env.AUTH_STACK_NAME || "awp-auth"})`);
  await $`sam deploy --parameter-overrides ${overridesStr}`.cwd(ROOT_DIR);
  console.log();

  console.log("Backend deployment complete!");
  console.log();
}

async function deployFrontend(): Promise<void> {
  console.log("=".repeat(60));
  console.log("Deploying Frontend");
  console.log("=".repeat(60));
  console.log();

  console.log("Building frontend...");
  await $`bun run build:frontend`.cwd(ROOT_DIR);
  console.log();

  console.log("Uploading to S3...");
  await $`bun run scripts/deploy-frontend.ts`.cwd(ROOT_DIR);
  console.log();

  console.log("Frontend deployment complete!");
  console.log();
}

async function main() {
  console.log();
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           CASFA - Full Stack Deployment                    ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  const startTime = Date.now();

  try {
    await deployBackend();
    await deployFrontend();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log("=".repeat(60));
    console.log(`Full stack deployment complete! (${elapsed}s)`);
    console.log("=".repeat(60));
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main();
