/**
 * CASFA v2 - Application Assembly
 *
 * Pure assembly function that wires up all dependencies.
 * All dependencies must be injected - no fallback logic.
 */

import { createHash } from "node:crypto";
import type { HashProvider, StorageProvider } from "@agent-web-portal/cas-storage-core";
import type { Hono } from "hono";
import type { DbInstances } from "./bootstrap.ts";
import type { AppConfig } from "./config.ts";
// Controllers
import {
  createAdminController,
  createAuthClientsController,
  createAuthTokensController,
  createChunksController,
  createDepotsController,
  createHealthController,
  createInfoController,
  createOAuthController,
  createRealmController,
} from "./controllers/index.ts";
import { createTicketsController } from "./controllers/tickets.ts";
// MCP
import { createMcpController } from "./mcp/index.ts";

// Middleware
import {
  createAdminAccessMiddleware,
  createAuthMiddleware,
  createRealmAccessMiddleware,
  createTicketAuthMiddleware,
  createWriteAccessMiddleware,
  type JwtVerifier,
} from "./middleware/index.ts";
// Router
import { createRouter } from "./router.ts";
// Services
import type { AuthService } from "./services/auth.ts";
import type { Env } from "./types.ts";

// Re-export DbInstances for convenience
export type { DbInstances } from "./bootstrap.ts";

// ============================================================================
// Hash Provider (Node.js)
// ============================================================================

export const createNodeHashProvider = (): HashProvider => ({
  sha256: async (data) => {
    const hash = createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  },
});

// ============================================================================
// Types
// ============================================================================

/**
 * All dependencies required by the application.
 * All fields are required - no optional/fallback logic.
 */
export type AppDependencies = {
  config: AppConfig;
  db: DbInstances;
  storage: StorageProvider;
  authService: AuthService;
  hashProvider: HashProvider;
  /** Optional JWT verifier for Bearer token auth. If not provided, JWT auth is disabled. */
  jwtVerifier?: JwtVerifier;
  /** Runtime configuration for /api/info endpoint */
  runtimeInfo?: {
    storageType: "memory" | "fs" | "s3";
    authType: "mock" | "cognito" | "tokens-only";
    databaseType: "local" | "aws";
  };
};

// ============================================================================
// App Factory
// ============================================================================

/**
 * Create the Hono app with all dependencies wired up.
 *
 * This is a pure assembly function - all dependencies must be provided.
 */
export const createApp = (deps: AppDependencies): Hono<Env> => {
  const { config, db, storage, authService, hashProvider, jwtVerifier, runtimeInfo } = deps;
  const {
    tokensDb,
    ownershipDb,
    depotsDb,
    refCountDb,
    usageDb,
    userRolesDb,
    awpPubkeysDb,
    clientPendingDb,
    clientPubkeysDb,
  } = db;

  // Middleware
  const authMiddleware = createAuthMiddleware({
    tokensDb,
    userRolesDb,
    awpPubkeysDb,
    jwtVerifier,
  });
  const ticketAuthMiddleware = createTicketAuthMiddleware({ tokensDb });
  const realmAccessMiddleware = createRealmAccessMiddleware();
  const writeAccessMiddleware = createWriteAccessMiddleware();
  const adminAccessMiddleware = createAdminAccessMiddleware();

  // Controllers
  const health = createHealthController();
  const info = createInfoController({
    serverConfig: config.server,
    featuresConfig: config.features,
    storageType: runtimeInfo?.storageType ?? "memory",
    authType: runtimeInfo?.authType ?? "tokens-only",
    databaseType: runtimeInfo?.databaseType ?? "aws",
  });
  const oauth = createOAuthController({
    cognitoConfig: config.cognito,
    authService,
  });
  const authClients = createAuthClientsController({
    clientPendingDb,
    clientPubkeysDb,
  });
  const authTokens = createAuthTokensController({ tokensDb });
  const admin = createAdminController({
    userRolesDb,
    cognitoConfig: config.cognito,
  });
  const realm = createRealmController({
    usageDb,
    serverConfig: config.server,
  });
  const tickets = createTicketsController({
    tokensDb,
    serverConfig: config.server,
  });
  const chunks = createChunksController({
    storage,
    hashProvider,
    ownershipDb,
    refCountDb,
    usageDb,
  });
  const depots = createDepotsController({
    depotsDb,
    storage,
  });
  const mcp = createMcpController({
    tokensDb,
    ownershipDb,
    storage,
    serverConfig: config.server,
  });

  // Create router
  return createRouter({
    health,
    info,
    oauth,
    authClients,
    authTokens,
    admin,
    realm,
    tickets,
    chunks,
    depots,
    mcp,
    authMiddleware,
    ticketAuthMiddleware,
    realmAccessMiddleware,
    writeAccessMiddleware,
    adminAccessMiddleware,
  });
};
