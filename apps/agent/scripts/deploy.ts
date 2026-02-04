#!/usr/bin/env bun

/**
 * AWP Agent - Full Stack Deployment Script
 *
 * This stack only has frontend (static site), no Lambda backend.
 *
 * Usage:
 *   bun run deploy              # Deploy SAM stack + frontend
 */

import { join } from "node:path";
import { $ } from "bun";

const ROOT_DIR = join(import.meta.dir, "..");

async function deploySAM(): Promise<void> {
  console.log("Running SAM build...");
  await $`sam build`.cwd(ROOT_DIR);
  console.log();

  console.log("Running SAM deploy...");
  await $`sam deploy`.cwd(ROOT_DIR);
  console.log();
}

async function deployFrontend(): Promise<void> {
  console.log("Building frontend...");
  await $`bun run build:frontend`.cwd(ROOT_DIR);
  console.log();

  console.log("Uploading to S3...");
  await $`bun run scripts/deploy-frontend.ts`.cwd(ROOT_DIR);
}

async function main(): Promise<void> {
  const startTime = Date.now();

  console.log();
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║           AWP Agent - Full Stack Deployment                ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  console.log();

  // Deploy SAM stack (creates S3 bucket and CloudFront)
  console.log("============================================================");
  console.log("Deploying Infrastructure (SAM)");
  console.log("============================================================");
  console.log();

  try {
    await deploySAM();
    console.log("Infrastructure deployment complete!");
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }

  console.log();

  // Deploy frontend to S3
  console.log("============================================================");
  console.log("Deploying Frontend");
  console.log("============================================================");
  console.log();

  try {
    await deployFrontend();
    console.log("Frontend deployment complete!");
  } catch (error) {
    console.error("Frontend deployment failed:", error);
    process.exit(1);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log();
  console.log("============================================================");
  console.log(`Full stack deployment complete! (${elapsed}s)`);
  console.log("============================================================");
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exit(1);
});
