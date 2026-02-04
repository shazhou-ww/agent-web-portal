#!/usr/bin/env bun
/**
 * CASFA v2 Development Server CLI
 *
 * This script provides flexible configuration options for local development.
 *
 * Usage:
 *   bun run backend/scripts/dev.ts                     # Default: persistent DB + fs storage + mock auth
 *   bun run backend/scripts/dev.ts --preset e2e        # All in-memory + mock auth (for tests)
 *   bun run backend/scripts/dev.ts --preset local      # Persistent DB + fs storage + mock auth
 *   bun run backend/scripts/dev.ts --preset dev        # Connect to AWS services
 *
 *   # Custom configuration:
 *   bun run backend/scripts/dev.ts --db memory --storage memory --auth mock
 *
 * Presets:
 *   e2e   - All in-memory (DynamoDB port 8701) + mock JWT, ideal for E2E tests
 *   local - Persistent DynamoDB (port 8700) + fs storage + mock JWT, for local development
 *   dev   - Connect to real AWS services (Cognito + S3), for integration testing
 */

import { spawn } from "node:child_process";
import { Command } from "commander";
import { createAllTables, listTables, createClient } from "./create-local-tables.ts";

// ============================================================================
// CLI Configuration
// ============================================================================

type DbType = "memory" | "persistent" | "aws";
type StorageType = "memory" | "fs" | "s3";
type AuthType = "mock" | "cognito";
type PresetType = "e2e" | "local" | "dev";

interface DevConfig {
  db: DbType;
  storage: StorageType;
  auth: AuthType;
  port: number;
  skipTableCreation: boolean;
}

// Preset configurations
const presets: Record<PresetType, Partial<DevConfig>> = {
  e2e: {
    db: "memory",
    storage: "memory",
    auth: "mock",
  },
  local: {
    db: "persistent",
    storage: "fs",
    auth: "mock",
  },
  dev: {
    db: "aws",
    storage: "s3",
    auth: "cognito",
  },
};

// ============================================================================
// DynamoDB Port Mapping
// ============================================================================

const DB_PORTS: Record<DbType, string | undefined> = {
  memory: "http://localhost:8701", // In-memory DynamoDB (dynamodb-test container)
  persistent: "http://localhost:8700", // Persistent DynamoDB (dynamodb container)
  aws: undefined, // Use AWS default
};

// ============================================================================
// Helpers
// ============================================================================

async function checkDynamoDBConnection(endpoint: string): Promise<boolean> {
  try {
    const client = createClient(endpoint);
    await listTables(client);
    return true;
  } catch {
    return false;
  }
}

async function waitForDynamoDB(endpoint: string, maxAttempts = 10, delayMs = 1000): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`Checking DynamoDB connection at ${endpoint}... (attempt ${i + 1}/${maxAttempts})`);
    if (await checkDynamoDBConnection(endpoint)) {
      console.log("DynamoDB is ready!\n");
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return false;
}

async function ensureTablesExist(endpoint: string): Promise<void> {
  const client = createClient(endpoint);
  const existingTables = await listTables(client);

  // Check if all required tables exist
  const requiredTables = ["cas-tokens", "cas-realm", "cas-refcount", "cas-usage"];
  const missingTables = requiredTables.filter((t) => !existingTables.includes(t));

  if (missingTables.length > 0) {
    console.log(`Creating missing tables: ${missingTables.join(", ")}`);
    await createAllTables(client);
  } else {
    console.log("All tables already exist.");
  }
}

function buildEnvVars(config: DevConfig): Record<string, string> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    PORT: config.port.toString(),
    STORAGE_TYPE: config.storage,
  };

  // DynamoDB endpoint
  const dbEndpoint = DB_PORTS[config.db];
  if (dbEndpoint) {
    env.DYNAMODB_ENDPOINT = dbEndpoint;
  }

  // Storage configuration
  if (config.storage === "fs") {
    env.STORAGE_FS_PATH = process.env.STORAGE_FS_PATH ?? "./local-storage";
  }

  // Auth configuration
  if (config.auth === "mock") {
    env.MOCK_JWT_SECRET = process.env.MOCK_JWT_SECRET ?? "dev-secret-key";
  }

  return env;
}

function startServer(env: Record<string, string>): Promise<number> {
  return new Promise((resolve) => {
    const serverProcess = spawn("bun", ["run", "backend/server.ts"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env,
      shell: true,
    });

    serverProcess.on("close", (code) => {
      resolve(code ?? 0);
    });

    serverProcess.on("error", (err) => {
      console.error("Failed to start server:", err);
      resolve(1);
    });
  });
}

// ============================================================================
// Main
// ============================================================================

const program = new Command();

program
  .name("dev")
  .description("CASFA v2 Development Server with configurable options")
  .option("--db <type>", "DynamoDB type: memory (8701), persistent (8700), aws", "persistent")
  .option("--storage <type>", "Storage type: memory, fs, s3", "fs")
  .option("--auth <type>", "Auth type: mock, cognito", "mock")
  .option("--preset <name>", "Use preset configuration: e2e, local, dev")
  .option("--port <number>", "Server port", "8801")
  .option("--skip-tables", "Skip table creation/verification", false)
  .action(async (options) => {
    // Apply preset if specified
    let config: DevConfig = {
      db: options.db as DbType,
      storage: options.storage as StorageType,
      auth: options.auth as AuthType,
      port: Number.parseInt(options.port, 10),
      skipTableCreation: options.skipTables,
    };

    if (options.preset) {
      const preset = presets[options.preset as PresetType];
      if (!preset) {
        console.error(`Unknown preset: ${options.preset}`);
        console.error("Available presets: e2e, local, dev");
        process.exit(1);
      }
      config = { ...config, ...preset };
    }

    console.log("=".repeat(60));
    console.log("CASFA v2 Development Server");
    console.log("=".repeat(60));
    console.log();
    console.log("Configuration:");
    console.log(`  Database: ${config.db} (${DB_PORTS[config.db] ?? "AWS default"})`);
    console.log(`  Storage:  ${config.storage}`);
    console.log(`  Auth:     ${config.auth}`);
    console.log(`  Port:     ${config.port}`);
    console.log();

    // If using local DynamoDB, ensure it's running and tables exist
    if (config.db !== "aws" && !config.skipTableCreation) {
      const endpoint = DB_PORTS[config.db]!;

      console.log(`Checking DynamoDB at ${endpoint}...`);
      const isReady = await waitForDynamoDB(endpoint, 5, 1000);

      if (!isReady) {
        const containerName = config.db === "memory" ? "dynamodb-test" : "dynamodb";
        console.error(`\nError: DynamoDB is not running at ${endpoint}`);
        console.error(`Please start it with: docker compose up -d ${containerName}`);
        process.exit(1);
      }

      await ensureTablesExist(endpoint);
      console.log();
    }

    // Build environment variables
    const env = buildEnvVars(config);

    // Start the server
    console.log("Starting server...\n");
    const exitCode = await startServer(env);
    process.exit(exitCode);
  });

program.parse();
