/**
 * CASFA v2 - Application Assembly
 *
 * Creates the Hono app with all dependencies wired up.
 */

import { createHash } from "node:crypto"
import type { Hono } from "hono"
import type { StorageProvider, HashProvider } from "@agent-web-portal/cas-storage-core"
import { createS3Storage } from "@agent-web-portal/cas-storage-s3"
import { createMemoryStorage } from "@agent-web-portal/cas-storage-memory"
import type { Env } from "./types.ts"
import { loadConfig, type AppConfig } from "./config.ts"

// DB
import {
  createTokensDb,
  createOwnershipDb,
  createCommitsDb,
  createDepotsDb,
  createRefCountDb,
  createUsageDb,
  createUserRolesDb,
  createAwpPendingDb,
  createAwpPubkeysDb,
} from "./db/index.ts"

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

// Services
import { createAuthService } from "./services/index.ts"

// MCP
import { createMcpController } from "./mcp/index.ts"

// Router
import { createRouter } from "./router.ts"

// ============================================================================
// Hash Provider (Node.js)
// ============================================================================

const createNodeHashProvider = (): HashProvider => ({
  sha256: async (data) => {
    const hash = createHash("sha256").update(data).digest()
    return new Uint8Array(hash)
  },
})

// ============================================================================
// Types
// ============================================================================

import type { TokensDb } from "./db/tokens.ts"
import type { OwnershipDb } from "./db/ownership.ts"
import type { CommitsDb } from "./db/commits.ts"
import type { DepotsDb } from "./db/depots.ts"
import type { RefCountDb } from "./db/refcount.ts"
import type { UsageDb } from "./db/usage.ts"
import type { UserRolesDb } from "./db/user-roles.ts"
import type { AwpPendingDb } from "./db/awp-pending.ts"
import type { AwpPubkeysDb } from "./db/awp-pubkeys.ts"

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

// ============================================================================
// App Factory
// ============================================================================

export type AppOptions = {
  config?: AppConfig
  storage?: StorageProvider
  useMemoryStorage?: boolean
  /**
   * Inject custom DB instances (for testing with in-memory databases)
   */
  db?: Partial<DbInstances>
}

export const createApp = (options: AppOptions = {}): Hono<Env> => {
  const config = options.config ?? loadConfig()

  // Storage
  const storage: StorageProvider = options.storage
    ?? (options.useMemoryStorage
      ? createMemoryStorage()
      : createS3Storage({ bucket: config.storage.bucket, prefix: config.storage.prefix }))

  const hashProvider = createNodeHashProvider()

  // DB layer - use injected instances or create from config
  const tokensDb = options.db?.tokensDb ?? createTokensDb({ tableName: config.db.tokensTable })
  const ownershipDb = options.db?.ownershipDb ?? createOwnershipDb({ tableName: config.db.casRealmTable })
  const commitsDb = options.db?.commitsDb ?? createCommitsDb({ tableName: config.db.casRealmTable })
  const depotsDb = options.db?.depotsDb ?? createDepotsDb({ tableName: config.db.casRealmTable })
  const refCountDb = options.db?.refCountDb ?? createRefCountDb({ tableName: config.db.refCountTable })
  const usageDb = options.db?.usageDb ?? createUsageDb({ tableName: config.db.usageTable })
  const userRolesDb = options.db?.userRolesDb ?? createUserRolesDb({ tableName: config.db.tokensTable })
  const awpPendingDb = options.db?.awpPendingDb ?? createAwpPendingDb({ tableName: config.db.tokensTable })
  const awpPubkeysDb = options.db?.awpPubkeysDb ?? createAwpPubkeysDb({ tableName: config.db.tokensTable })

  // Services
  const authService = createAuthService({
    tokensDb,
    userRolesDb,
    cognitoConfig: config.cognito,
  })

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
