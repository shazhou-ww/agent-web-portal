/**
 * CASFA v2 - Application Assembly
 *
 * Pure assembly function that wires up all dependencies.
 * All dependencies must be injected - no fallback logic.
 */

import { createHash } from "node:crypto"
import type { Hono } from "hono"
import type { StorageProvider, HashProvider } from "@agent-web-portal/cas-storage-core"
import type { Env } from "./types.ts"
import type { AppConfig } from "./config.ts"

// DB Types
import type { TokensDb } from "./db/tokens.ts"
import type { OwnershipDb } from "./db/ownership.ts"
import type { CommitsDb } from "./db/commits.ts"
import type { DepotsDb } from "./db/depots.ts"
import type { RefCountDb } from "./db/refcount.ts"
import type { UsageDb } from "./db/usage.ts"
import type { UserRolesDb } from "./db/user-roles.ts"
import type { AwpPendingDb } from "./db/awp-pending.ts"
import type { AwpPubkeysDb } from "./db/awp-pubkeys.ts"

// Services
import type { AuthService } from "./services/auth.ts"

// Middleware
import {
  createAuthMiddleware,
  createTicketAuthMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
  createAdminAccessMiddleware,
} from "./middleware/index.ts"

// Controllers
import {
  createHealthController,
  createOAuthController,
  createAuthClientsController,
  createAuthTicketsController,
  createAuthTokensController,
  createAdminController,
  createRealmController,
  createTicketController,
  createCommitsController,
  createChunksController,
  createDepotsController,
} from "./controllers/index.ts"

// MCP
import { createMcpController } from "./mcp/index.ts"

// Router
import { createRouter } from "./router.ts"

// ============================================================================
// Hash Provider (Node.js)
// ============================================================================

export const createNodeHashProvider = (): HashProvider => ({
  sha256: async (data) => {
    const hash = createHash("sha256").update(data).digest()
    return new Uint8Array(hash)
  },
})

// ============================================================================
// Types
// ============================================================================

export type DbInstances = {
  tokensDb: TokensDb
  ownershipDb: OwnershipDb
  commitsDb: CommitsDb
  depotsDb: DepotsDb
  refCountDb: RefCountDb
  usageDb: UsageDb
  userRolesDb: UserRolesDb
  awpPendingDb: AwpPendingDb
  awpPubkeysDb: AwpPubkeysDb
}

/**
 * All dependencies required by the application.
 * All fields are required - no optional/fallback logic.
 */
export type AppDependencies = {
  config: AppConfig
  db: DbInstances
  storage: StorageProvider
  authService: AuthService
  hashProvider: HashProvider
}

// ============================================================================
// App Factory
// ============================================================================

/**
 * Create the Hono app with all dependencies wired up.
 *
 * This is a pure assembly function - all dependencies must be provided.
 */
export const createApp = (deps: AppDependencies): Hono<Env> => {
  const { config, db, storage, authService, hashProvider } = deps
  const {
    tokensDb,
    ownershipDb,
    commitsDb,
    depotsDb,
    refCountDb,
    usageDb,
    userRolesDb,
    awpPendingDb,
    awpPubkeysDb,
  } = db

  // Middleware
  const authMiddleware = createAuthMiddleware({
    tokensDb,
    userRolesDb,
    awpPubkeysDb,
    cognitoConfig: config.cognito,
  })
  const ticketAuthMiddleware = createTicketAuthMiddleware({ tokensDb })
  const realmAccessMiddleware = createRealmAccessMiddleware()
  const writeAccessMiddleware = createWriteAccessMiddleware()
  const adminAccessMiddleware = createAdminAccessMiddleware()

  // Controllers
  const health = createHealthController()
  const oauth = createOAuthController({
    cognitoConfig: config.cognito,
    authService,
  })
  const authClients = createAuthClientsController({
    awpPendingDb,
    awpPubkeysDb,
  })
  const authTickets = createAuthTicketsController({
    tokensDb,
    serverConfig: config.server,
  })
  const authTokens = createAuthTokensController({ tokensDb })
  const admin = createAdminController({
    userRolesDb,
    cognitoConfig: config.cognito,
  })
  const realm = createRealmController({
    usageDb,
    serverConfig: config.server,
  })
  const ticket = createTicketController({
    tokensDb,
    usageDb,
  })
  const commits = createCommitsController({
    commitsDb,
    ownershipDb,
    refCountDb,
    tokensDb,
    storage,
  })
  const chunks = createChunksController({
    storage,
    hashProvider,
    ownershipDb,
    refCountDb,
    usageDb,
  })
  const depots = createDepotsController({
    depotsDb,
    refCountDb,
    storage,
  })
  const mcp = createMcpController({
    tokensDb,
    ownershipDb,
    storage,
    serverConfig: config.server,
  })

  // Create router
  return createRouter({
    health,
    oauth,
    authClients,
    authTickets,
    authTokens,
    admin,
    realm,
    ticket,
    commits,
    chunks,
    depots,
    mcp,
    authMiddleware,
    ticketAuthMiddleware,
    realmAccessMiddleware,
    writeAccessMiddleware,
    adminAccessMiddleware,
  })
}
