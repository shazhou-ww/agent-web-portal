/**
 * CASFA v2 - Production/Development Server
 *
 * This server uses real implementations:
 * - DynamoDB for database
 * - S3 for storage (or memory storage for local dev)
 * - Cognito for authentication
 */

import { createMemoryStorage } from "@agent-web-portal/cas-storage-memory";
import { createS3Storage } from "@agent-web-portal/cas-storage-s3";
import { createApp, createNodeHashProvider } from "./src/app.ts";
import { loadConfig } from "./src/config.ts";

// DB factories
import {
  createAwpPendingDb,
  createAwpPubkeysDb,
  createCommitsDb,
  createDepotsDb,
  createOwnershipDb,
  createRefCountDb,
  createTokensDb,
  createUsageDb,
  createUserRolesDb,
} from "./src/db/index.ts";

// Auth service
import { createAuthService } from "./src/services/auth.ts";

// ============================================================================
// Configuration
// ============================================================================

const port = Number.parseInt(process.env.CAS_API_PORT ?? process.env.PORT ?? "3560", 10);
const useMemoryStorage = process.env.USE_MEMORY_STORAGE === "true" || !process.env.CAS_BUCKET;

// Load configuration
const config = loadConfig();

// ============================================================================
// Create Dependencies
// ============================================================================

// Create DB instances
const db = {
  tokensDb: createTokensDb({ tableName: config.db.tokensTable }),
  ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
  commitsDb: createCommitsDb({ tableName: config.db.casRealmTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  awpPendingDb: createAwpPendingDb({ tableName: config.db.tokensTable }),
  awpPubkeysDb: createAwpPubkeysDb({ tableName: config.db.tokensTable }),
};

// Create storage (S3 or memory for local dev)
const storage = useMemoryStorage
  ? createMemoryStorage()
  : createS3Storage({ bucket: config.storage.bucket, prefix: config.storage.prefix });

// Create auth service (Cognito)
const authService = createAuthService({
  tokensDb: db.tokensDb,
  userRolesDb: db.userRolesDb,
  cognitoConfig: config.cognito,
});

// Create hash provider
const hashProvider = createNodeHashProvider();

// ============================================================================
// Create App
// ============================================================================

const app = createApp({
  config,
  db,
  storage,
  authService,
  hashProvider,
});

// ============================================================================
// Start Server
// ============================================================================

console.log(`[CASFA v2] Starting server...`);
console.log(`[CASFA v2] Listening on http://localhost:${port}`);
console.log(`[CASFA v2] Storage: ${useMemoryStorage ? "in-memory" : "S3"}`);

Bun.serve({
  port,
  fetch: app.fetch,
});
