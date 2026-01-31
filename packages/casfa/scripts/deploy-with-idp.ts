#!/usr/bin/env bun
/**
 * Deploy cas-stack with external Identity Providers (Google and/or Microsoft).
 * Reads credentials from env (e.g. from .env).
 *
 * Usage:
 *   cd packages/cas-stack
 *   # Set in .env: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET
 *   bun run scripts/deploy-with-idp.ts
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env from repo root first, then package root (package overrides repo)
const pkgRoot = join(import.meta.dir, "..");
const repoRoot = join(pkgRoot, "../..");

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
loadEnvFile(repoRoot);
loadEnvFile(pkgRoot);

const cognitoDomain = process.env.COGNITO_DOMAIN || "awp-cas-ui";
const callbackBaseUrl = process.env.CALLBACK_BASE_URL || "";

// Google credentials
const googleClientId = process.env.GOOGLE_CLIENT_ID || "";
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
const hasGoogle = googleClientId && googleClientSecret;

// Microsoft credentials
const microsoftClientId = process.env.MICROSOFT_CLIENT_ID || "";
const microsoftClientSecret = process.env.MICROSOFT_CLIENT_SECRET || "";
const hasMicrosoft = microsoftClientId && microsoftClientSecret;

if (!hasGoogle && !hasMicrosoft) {
  console.error("No Identity Provider configured. Set at least one of:");
  console.error("  - GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET");
  console.error("  - MICROSOFT_CLIENT_ID + MICROSOFT_CLIENT_SECRET");
  console.error("in .env or environment variables.");
  process.exit(1);
}

const overrides: string[] = [`CognitoDomain=${cognitoDomain}`];

if (hasGoogle) {
  overrides.push(`GoogleClientId=${googleClientId}`);
  overrides.push(`GoogleClientSecret=${googleClientSecret}`);
}

if (hasMicrosoft) {
  overrides.push(`MicrosoftClientId=${microsoftClientId}`);
  overrides.push(`MicrosoftClientSecret=${microsoftClientSecret}`);
}

if (callbackBaseUrl) {
  overrides.push(`CallbackBaseUrl=${callbackBaseUrl}`);
}

const idpList = [hasGoogle && "Google", hasMicrosoft && "Microsoft"].filter(Boolean).join(" + ");
console.log(`Deploying with ${idpList} (CognitoDomain=${cognitoDomain})...`);

const child = spawn("sam", ["deploy", "--parameter-overrides", overrides.join(" ")], {
  cwd: pkgRoot,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
