#!/usr/bin/env bun
/**
 * Deploy cas-stack with Google OAuth (Cognito Hosted UI).
 * Reads GOOGLE_CLIENT_SECRET and optional CognitoDomain from env (e.g. from .env).
 *
 * Usage:
 *   cd packages/cas-stack
 *   # Set in .env: GOOGLE_CLIENT_SECRET=xxx, optional: COGNITO_DOMAIN=my-prefix
 *   bun run scripts/deploy-with-google.ts
 *
 * Or inline:
 *   GOOGLE_CLIENT_SECRET=xxx bun run scripts/deploy-with-google.ts
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Load .env from package root or repo root
const pkgRoot = join(import.meta.dir, "..");
const repoRoot = join(pkgRoot, "../..");
for (const dir of [pkgRoot, repoRoot]) {
  const envPath = join(dir, ".env");
  if (existsSync(envPath)) {
    const content = readFileSync(envPath, "utf-8");
    for (const line of content.split("\n")) {
      const t = line.trim();
      if (t && !t.startsWith("#")) {
        const eq = t.indexOf("=");
        if (eq > 0) {
          const key = t.slice(0, eq).trim();
          const value = t.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
          if (!(key in process.env)) process.env[key] = value;
        }
      }
    }
    break;
  }
}

const secret = process.env.GOOGLE_CLIENT_SECRET;
const cognitoDomain = process.env.COGNITO_DOMAIN || "awp-cas-ui";
const callbackBaseUrl = process.env.CALLBACK_BASE_URL || ""; // e.g. https://xxx.cloudfront.net (optional; add after first deploy to enable prod Google callback)
const googleClientId =
  process.env.GOOGLE_CLIENT_ID ||
  "1084492958564-ngqgsjbss5ta8676oa101rrg9prcankv.apps.googleusercontent.com";

if (!secret) {
  console.error("Missing GOOGLE_CLIENT_SECRET. Set it in .env or env:");
  console.error("  GOOGLE_CLIENT_SECRET=your-secret bun run scripts/deploy-with-google.ts");
  process.exit(1);
}

const overrides = [
  `CognitoDomain=${cognitoDomain}`,
  `GoogleClientId=${googleClientId}`,
  `GoogleClientSecret=${secret}`,
  ...(callbackBaseUrl ? [`CallbackBaseUrl=${callbackBaseUrl}`] : []),
].join(" ");

console.log("Deploying with Google OAuth (CognitoDomain=%s)...", cognitoDomain);
const child = spawn("sam", ["deploy", "--parameter-overrides", overrides], {
  cwd: pkgRoot,
  stdio: "inherit",
  shell: true,
});
child.on("exit", (code) => process.exit(code ?? 0));
