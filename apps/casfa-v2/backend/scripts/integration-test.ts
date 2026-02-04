#!/usr/bin/env bun
/**
 * CASFA v2 Integration Test Runner
 *
 * This script:
 * 1. Checks if DynamoDB Local is running
 * 2. Creates test tables
 * 3. Runs e2e tests
 * 4. Cleans up (tables and file storage)
 *
 * Prerequisites:
 *   docker compose up -d dynamodb
 *
 * Usage:
 *   bun run backend/scripts/integration-test.ts
 *   bun run backend/scripts/integration-test.ts --no-cleanup   # Skip cleanup (for debugging)
 *   bun run backend/scripts/integration-test.ts --skip-tables  # Skip table creation (tables already exist)
 *
 * Environment variables (defaults for testing):
 *   DYNAMODB_ENDPOINT=http://localhost:8700
 *   STORAGE_TYPE=memory
 *   MOCK_JWT_SECRET=test-secret-key-for-e2e
 */

import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { createAllTables, deleteAllTables, listTables } from "./create-local-tables.ts";

// ============================================================================
// Configuration
// ============================================================================

const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT ?? "http://localhost:8700";
const STORAGE_TYPE = process.env.STORAGE_TYPE ?? "memory";
const STORAGE_FS_PATH = process.env.STORAGE_FS_PATH ?? "./test-storage";
const MOCK_JWT_SECRET = process.env.MOCK_JWT_SECRET ?? "test-secret-key-for-e2e";

const args = process.argv.slice(2);
const shouldCleanup = !args.includes("--no-cleanup"); // Default: cleanup
const shouldSkipTableCreation = args.includes("--skip-tables");

// ============================================================================
// Helpers
// ============================================================================

async function checkDynamoDBConnection(): Promise<boolean> {
  try {
    await listTables();
    return true;
  } catch (error) {
    return false;
  }
}

async function waitForDynamoDB(maxAttempts = 10, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Checking DynamoDB connection... (attempt ${i + 1}/${maxAttempts})`);
    if (await checkDynamoDBConnection()) {
      console.log("DynamoDB is ready!\n");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

function runTests(): Promise<number> {
  return new Promise((resolve) => {
    console.log("Running e2e tests...\n");

    const testProcess = spawn("bun", ["test", "backend/e2e"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: {
        ...process.env,
        DYNAMODB_ENDPOINT,
        STORAGE_TYPE,
        STORAGE_FS_PATH,
        MOCK_JWT_SECRET,
      },
      shell: true,
    });

    testProcess.on("close", (code) => {
      resolve(code ?? 1);
    });

    testProcess.on("error", (err) => {
      console.error("Failed to run tests:", err);
      resolve(1);
    });
  });
}

function cleanupFileStorage(): void {
  if (STORAGE_TYPE === "fs" && STORAGE_FS_PATH) {
    try {
      rmSync(STORAGE_FS_PATH, { recursive: true, force: true });
      console.log(`Cleaned up file storage: ${STORAGE_FS_PATH}`);
    } catch {
      // Ignore cleanup errors
    }
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log("=".repeat(60));
  console.log("CASFA v2 Integration Test Runner");
  console.log("=".repeat(60));
  console.log();
  console.log("Configuration:");
  console.log(`  DYNAMODB_ENDPOINT: ${DYNAMODB_ENDPOINT}`);
  console.log(`  STORAGE_TYPE: ${STORAGE_TYPE}`);
  console.log(`  MOCK_JWT_SECRET: ${MOCK_JWT_SECRET ? "(set)" : "(not set)"}`);
  if (STORAGE_TYPE === "fs") {
    console.log(`  STORAGE_FS_PATH: ${STORAGE_FS_PATH}`);
  }
  console.log();

  // Check DynamoDB connection
  console.log("Checking DynamoDB Local...");
  const isReady = await waitForDynamoDB();

  if (!isReady) {
    console.error("\nError: DynamoDB Local is not running!");
    console.error("Please start it with: docker compose up -d dynamodb");
    process.exit(1);
  }

  // Create tables
  if (!shouldSkipTableCreation) {
    console.log("Creating test tables...");
    await createAllTables();
    console.log();
  }

  // Run tests
  const exitCode = await runTests();

  // Cleanup
  if (shouldCleanup) {
    console.log("\nCleaning up...");
    await deleteAllTables();
    cleanupFileStorage();
  }

  console.log();
  console.log("=".repeat(60));
  if (exitCode === 0) {
    console.log("All tests passed!");
  } else {
    console.log(`Tests failed with exit code: ${exitCode}`);
  }
  console.log("=".repeat(60));

  process.exit(exitCode);
}

main().catch((err) => {
  console.error("Integration test runner failed:", err);
  process.exit(1);
});
