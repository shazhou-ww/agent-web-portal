/**
 * Deploy AWP Shared Auth Infrastructure
 *
 * Reads IdP credentials from .env files (repo root and local) and deploys
 * the Cognito User Pool with configured identity providers.
 *
 * Usage:
 *   bun run deploy
 *
 * Environment variables (in .env):
 *   COGNITO_DOMAIN                 (required for Hosted UI, e.g. 'awp-auth')
 *   GOOGLE_CLIENT_ID               (for Google sign-in)
 *   GOOGLE_CLIENT_SECRET           (for Google sign-in)
 *   MICROSOFT_CLIENT_ID            (for Microsoft sign-in)
 *   MICROSOFT_CLIENT_SECRET        (for Microsoft sign-in)
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPT_DIR = import.meta.dir;
const ROOT_DIR = join(SCRIPT_DIR, "..");
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

// Load repo root first, then local (later overrides earlier)
loadEnvFile(REPO_ROOT);
loadEnvFile(ROOT_DIR);

function buildParameterOverrides(): string[] {
  const overrides: string[] = [];

  // Cognito Domain (required for Hosted UI)
  const cognitoDomain = process.env.COGNITO_DOMAIN || "";
  if (cognitoDomain) {
    overrides.push(`CognitoDomain=${cognitoDomain}`);
  }

  // Google credentials
  const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
  const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (googleClientId && googleClientSecret) {
    overrides.push(`GoogleClientId=${googleClientId}`);
    overrides.push(`GoogleClientSecret=${googleClientSecret}`);
    console.log("  ✓ Google IdP configured");
  }

  // Microsoft credentials
  const microsoftClientId = process.env.MICROSOFT_CLIENT_ID || "";
  const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
  if (microsoftClientId && microsoftClientSecret) {
    overrides.push(`MicrosoftClientId=${microsoftClientId}`);
    overrides.push(`MicrosoftClientSecret=${microsoftClientSecret}`);
    console.log("  ✓ Microsoft IdP configured");
  }

  return overrides;
}

async function main(): Promise<void> {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║         AWP Shared Auth Infrastructure - Deploy              ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  const overrides = buildParameterOverrides();

  if (!process.env.COGNITO_DOMAIN) {
    console.error("ERROR: COGNITO_DOMAIN is required");
    console.error("Set COGNITO_DOMAIN in .env (e.g. COGNITO_DOMAIN=awp-auth)");
    process.exit(1);
  }

  console.log();
  console.log("Deploying with SAM...");
  console.log();

  const samArgs = ["deploy", "--no-fail-on-empty-changeset"];
  if (overrides.length > 0) {
    samArgs.push("--parameter-overrides", ...overrides);
  }

  const result = spawnSync("sam", samArgs, {
    cwd: ROOT_DIR,
    stdio: "inherit",
    shell: true,
  });

  if (result.status !== 0) {
    console.error("SAM deploy failed");
    process.exit(result.status || 1);
  }

  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                      Deploy Complete!                        ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log("Next steps:");
  console.log("  1. Note the UserPoolId and CognitoHostedUiUrl from outputs");
  console.log("  2. Update your .env with the new values");
  console.log("  3. Configure Google/Microsoft redirect URI:");
  console.log(`     https://${process.env.COGNITO_DOMAIN}.auth.us-east-1.amazoncognito.com/oauth2/idpresponse`);
  console.log();
}

main().catch((err) => {
  console.error("Deploy failed:", err);
  process.exit(1);
});
