#!/usr/bin/env bun
/**
 * List Cognito users and set specific user(s) as CAS admin.
 * Writes to the same DynamoDB tokens table (user#${userId} with role=admin).
 *
 * Prerequisites:
 *   - AWS credentials (or DYNAMODB_ENDPOINT for local)
 *   - COGNITO_USER_POOL_ID (and AWS_REGION if not us-east-1)
 *   - TOKENS_TABLE (default: cas-tokens)
 *
 * Usage:
 *   # List all Cognito users (sub, email, name)
 *   bun run scripts/set-admin-users.ts --list
 *
 *   # Set one user as admin by Cognito sub
 *   bun run scripts/set-admin-users.ts --set-admin <sub>
 *
 *   # Set one user as admin by email (matches Cognito username/email)
 *   bun run scripts/set-admin-users.ts --set-admin admin@example.com
 *
 *   # Set multiple users as admin (space-separated)
 *   bun run scripts/set-admin-users.ts --set-admin "sub-1" "sub-2" admin@example.com
 *
 * Env:
 *   COGNITO_USER_POOL_ID - Cognito User Pool ID (required for --list and --set-admin by email)
 *   AWS_REGION           - default us-east-1
 *   TOKENS_TABLE         - default cas-tokens
 *   DYNAMODB_ENDPOINT    - optional, for local DynamoDB
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { UserRolesDb } from "../backend/src/db/user-roles.ts";
import { loadConfig } from "../backend/src/types.ts";

// Load .env files (repo root first, then package root - later overrides earlier)
const SCRIPT_DIR = import.meta.dir;
const ROOT_DIR = join(SCRIPT_DIR, "..");
const REPO_ROOT = join(ROOT_DIR, "../..");

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
        if (!process.env[key]) {
          process.env[key] = value;
        }
      }
    }
  }
}

loadEnvFile(REPO_ROOT);
loadEnvFile(ROOT_DIR);

function parseArgs(): { list: boolean; setAdmin: string[] } {
  const args = process.argv.slice(2);
  let list = false;
  const setAdmin: string[] = [];

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--list" || args[i] === "-l") {
      list = true;
    } else if (args[i] === "--set-admin" || args[i] === "-s") {
      i++;
      while (i < args.length && !args[i]!.startsWith("-")) {
        setAdmin.push(args[i]!.trim());
        i++;
      }
      i--;
    }
  }

  return { list, setAdmin };
}

function isLikelySub(value: string): boolean {
  return value.length >= 20 && /^[a-f0-9-]+$/i.test(value);
}

async function listUsers(
  poolId: string,
  region: string
): Promise<{ sub: string; email: string; name?: string }[]> {
  const client = new CognitoIdentityProviderClient({ region });
  const out: { sub: string; email: string; name?: string }[] = [];
  let paginationToken: string | undefined;

  do {
    const result = await client.send(
      new ListUsersCommand({
        UserPoolId: poolId,
        Limit: 60,
        PaginationToken: paginationToken,
      })
    );

    for (const u of result.Users ?? []) {
      const sub = u.Attributes?.find((a) => a.Name === "sub")?.Value ?? u.Username ?? "";
      const email =
        u.Attributes?.find((a) => a.Name === "email")?.Value ??
        u.Attributes?.find((a) => a.Name === "preferred_username")?.Value ??
        u.Username ??
        "";
      const name = u.Attributes?.find((a) => a.Name === "name")?.Value;
      out.push({ sub, email, name });
    }

    paginationToken = result.PaginationToken;
  } while (paginationToken);

  return out;
}

async function main(): Promise<void> {
  const { list, setAdmin } = parseArgs();
  const config = loadConfig();
  const poolId = config.cognitoUserPoolId;
  const region = config.cognitoRegion;

  if (!poolId) {
    console.error("COGNITO_USER_POOL_ID is required. Set it in env or .env.");
    process.exit(1);
  }

  const userRolesDb = new UserRolesDb(config);

  if (list) {
    console.log("Listing Cognito users (sub, email, name)...\n");
    const users = await listUsers(poolId, region);
    if (users.length === 0) {
      console.log("No users found.");
      return;
    }
    for (const u of users) {
      console.log(`  ${u.sub}  ${u.email}  ${u.name ?? ""}`);
    }
    console.log(`\nTotal: ${users.length}`);
    console.log("\nTo set admin by sub:   bun run scripts/set-admin-users.ts --set-admin <sub>");
    console.log("To set admin by email: bun run scripts/set-admin-users.ts --set-admin <email>");
    return;
  }

  if (setAdmin.length === 0) {
    console.log("Usage:");
    console.log("  --list              List all Cognito users");
    console.log("  --set-admin <id>    Set user(s) as admin (sub or email)");
    console.log("\nExample: bun run scripts/set-admin-users.ts --set-admin admin@example.com");
    process.exit(0);
  }

  const users = await listUsers(poolId, region);
  const bySub = new Map(users.map((u) => [u.sub, u]));
  const byEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));

  for (const id of setAdmin) {
    const trimmed = id.trim();
    if (!trimmed) continue;

    let sub: string;
    if (isLikelySub(trimmed)) {
      if (!bySub.has(trimmed)) {
        console.error(`User not found (sub): ${trimmed}`);
        continue;
      }
      sub = trimmed;
    } else {
      const u = byEmail.get(trimmed.toLowerCase());
      if (!u) {
        console.error(`User not found (email): ${trimmed}`);
        continue;
      }
      sub = u.sub;
    }

    await userRolesDb.setRole(sub, "admin");
    const u = bySub.get(sub);
    console.log(`Set admin: ${sub}  ${u?.email ?? ""}  ${u?.name ?? ""}`);
  }

  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
