/**
 * CASFA - Full Stack Deploy Script
 *
 * Deploys both backend (SAM) and frontend (S3/CloudFront) in sequence.
 * IdP credentials are read from .env file (not hardcoded in samconfig.toml).
 *
 * Usage:
 *   bun run deploy              # Deploy everything
 *   bun run deploy:backend      # Deploy only backend (SAM)
 *   bun run deploy:frontend     # Deploy only frontend (S3)
 *
 * Required .env variables for IdP:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET       (for Google sign-in)
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET (for Microsoft sign-in)
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
function buildIdpOverrides(): string[] {
  const overrides: string[] = [];

  // Google credentials
  const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (googleClientId && googleClientSecret) {
    overrides.push(`GoogleClientId=${googleClientId}`);
    overrides.push(`GoogleClientSecret=${googleClientSecret}`);
  }

  // Microsoft credentials
  const microsoftClientId = process.env.MICROSOFT_CLIENT_ID || "";
  const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
  if (microsoftClientId && microsoftClientSecret) {
    overrides.push(`MicrosoftClientId=${microsoftClientId}`);
    overrides.push(`MicrosoftClientSecret=${microsoftClientSecret}`);
  }

  if (overrides.length === 0) {
    console.warn("WARNING: No IdP credentials found in .env");
    console.warn("Set GOOGLE_CLIENT_ID/SECRET or MICROSOFT_CLIENT_ID/SECRET");
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

  // Build IdP parameter overrides from .env
  const idpOverrides = buildIdpOverrides();

  console.log("Running SAM deploy...");
  if (idpOverrides.length > 0) {
    const overridesStr = idpOverrides.join(" ");
    console.log(`  (with IdP credentials from .env)`);
    await $`sam deploy --parameter-overrides ${overridesStr}`.cwd(ROOT_DIR);
  } else {
    await $`sam deploy`.cwd(ROOT_DIR);
  }
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
