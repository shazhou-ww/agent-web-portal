#!/usr/bin/env bun
/**
 * Setup local development environment for CASFA
 *
 * This script:
 *   1. Starts DynamoDB Local container (if not running)
 *   2. Waits for DynamoDB to be ready
 *   3. Creates required tables
 *
 * Usage:
 *   bun run setup:local
 */

import { spawnSync } from "node:child_process";

const DYNAMODB_CONTAINER = "dynamodb-local";
const DYNAMODB_PORT = Number(process.env.DYNAMODB_PORT) || 9000;
const DYNAMODB_ENDPOINT = `http://localhost:${DYNAMODB_PORT}`;

function run(cmd: string, args: string[], options?: { silent?: boolean }): { success: boolean; stdout: string } {
  const result = spawnSync(cmd, args, {
    shell: true,
    encoding: "utf-8",
    stdio: options?.silent ? "pipe" : "inherit",
  });
  return {
    success: result.status === 0,
    stdout: result.stdout?.toString() ?? "",
  };
}

function runSilent(cmd: string, args: string[]): { success: boolean; stdout: string } {
  return run(cmd, args, { silent: true });
}

async function waitForDynamoDB(maxAttempts = 30): Promise<boolean> {
  const { DynamoDBClient, ListTablesCommand } = await import("@aws-sdk/client-dynamodb");
  const client = new DynamoDBClient({
    region: "us-east-1",
    endpoint: DYNAMODB_ENDPOINT,
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });

  for (let i = 0; i < maxAttempts; i++) {
    try {
      await client.send(new ListTablesCommand({}));
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return false;
}

async function main(): Promise<void> {
  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║              CASFA Local Environment Setup                   ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();

  // Check if Docker is running
  const dockerCheck = runSilent("docker", ["info"]);
  if (!dockerCheck.success) {
    console.error("❌ Docker is not running. Please start Docker first.");
    process.exit(1);
  }
  console.log("✓ Docker is running");

  // Check if container already exists
  const containerCheck = runSilent("docker", ["ps", "-a", "--filter", `name=${DYNAMODB_CONTAINER}`, "--format", "{{.Status}}"]);
  const containerStatus = containerCheck.stdout.trim();

  if (containerStatus) {
    if (containerStatus.startsWith("Up")) {
      console.log(`✓ DynamoDB Local container is already running`);
    } else {
      // Container exists but stopped, start it
      console.log("Starting existing DynamoDB Local container...");
      const startResult = run("docker", ["start", DYNAMODB_CONTAINER]);
      if (!startResult.success) {
        console.error("❌ Failed to start DynamoDB Local container");
        process.exit(1);
      }
      console.log("✓ DynamoDB Local container started");
    }
  } else {
    // Container doesn't exist, create it
    console.log("Creating DynamoDB Local container...");
    const createResult = run("docker", [
      "run", "-d",
      "--name", DYNAMODB_CONTAINER,
      "-p", `${DYNAMODB_PORT}:8000`,
      "amazon/dynamodb-local"
    ]);
    if (!createResult.success) {
      console.error("❌ Failed to create DynamoDB Local container");
      process.exit(1);
    }
    console.log("✓ DynamoDB Local container created");
  }

  // Wait for DynamoDB to be ready
  console.log("Waiting for DynamoDB to be ready...");
  const ready = await waitForDynamoDB();
  if (!ready) {
    console.error("❌ DynamoDB failed to start within timeout");
    process.exit(1);
  }
  console.log("✓ DynamoDB is ready");

  // Create tables
  console.log();
  console.log("Creating tables...");
  const createTablesResult = run("bun", ["run", "create-local-tables"]);
  if (!createTablesResult.success) {
    console.error("❌ Failed to create tables");
    process.exit(1);
  }

  console.log();
  console.log("╔══════════════════════════════════════════════════════════════╗");
  console.log("║                    Setup Complete!                           ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");
  console.log();
  console.log(`DynamoDB Local: ${DYNAMODB_ENDPOINT}`);
  console.log();
  console.log("Next: run 'bun run dev' to start development servers");
  console.log();
}

main().catch((err) => {
  console.error("Setup failed:", err);
  process.exit(1);
});
