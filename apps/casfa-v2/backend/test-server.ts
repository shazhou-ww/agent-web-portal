/**
 * CASFA v2 - Test Server
 *
 * A server with in-memory databases and storage for testing.
 * No DynamoDB or S3 dependencies required.
 *
 * Usage:
 *   bun run test-server.ts
 *   bun run test-server.ts --port 3561
 */

import type { Hono } from "hono"
import { createMemoryStorage } from "@agent-web-portal/cas-storage-memory"
import type { StorageProvider } from "@agent-web-portal/cas-storage-core"
import { createApp, type DbInstances } from "./src/app.ts"
import type { AppConfig } from "./src/config.ts"
import type { Env } from "./src/types.ts"
import { createAllMemoryDbs, type AllDbs } from "./src/db-mock/index.ts"
import { extractTokenId } from "./src/util/token-id.ts"

// ============================================================================
// Test Config
// ============================================================================

/**
 * Default test configuration
 *
 * Note: Cognito userPoolId is set to empty string to skip CognitoUserPool initialization.
 * For tests that need Cognito, override with a valid userPoolId format (e.g., "us-east-1_XXXXXXXXX").
 */
export const createTestConfig = (overrides?: Partial<AppConfig>): AppConfig => ({
  server: {
    nodeLimit: 4194304,
    maxNameBytes: 255,
    maxCollectionChildren: 10000,
    maxPayloadSize: 10485760,
    maxTicketTtl: 86400,
    maxAgentTokenTtl: 2592000,
    baseUrl: "http://localhost:3560",
    ...overrides?.server,
  },
  db: {
    tokensTable: "test-tokens",
    casRealmTable: "test-cas-realm",
    casDagTable: "test-cas-dag",
    refCountTable: "test-refcount",
    usageTable: "test-usage",
    ...overrides?.db,
  },
  storage: {
    bucket: "test-bucket",
    prefix: "cas/sha256/",
    ...overrides?.storage,
  },
  cognito: {
    // Empty userPoolId skips CognitoUserPool initialization
    // Tests use direct database operations to create tokens
    userPoolId: "",
    clientId: "test-client-id",
    region: "us-east-1",
    hostedUiUrl: "https://test.auth.example.com",
    ...overrides?.cognito,
  },
})

// ============================================================================
// Test App Types
// ============================================================================

export type TestApp = {
  app: Hono<Env>
  db: AllDbs & { clearAll: () => void }
  storage: StorageProvider
  config: AppConfig
  reset: () => void
  helpers: TestHelpers
}

export type TestHelpers = {
  createTestUser: (userId: string, role?: "admin" | "authorized") => Promise<{
    userId: string
    token: string
    realm: string
  }>
  createTestTicket: (
    realm: string,
    issuerId: string,
    options?: { scope?: string[]; commit?: { quota?: number } }
  ) => Promise<{
    ticketId: string
    ticket: { realm: string; issuerId: string }
  }>
  authRequest: (token: string, method: string, path: string, body?: unknown) => Promise<Response>
}

export type CreateTestAppOptions = {
  config?: Partial<AppConfig>
}

// ============================================================================
// Test App Factory
// ============================================================================

/**
 * Create a test app with in-memory databases and storage
 */
export const createTestApp = (options: CreateTestAppOptions = {}): TestApp => {
  const config = createTestConfig(options.config)
  const db = createAllMemoryDbs()
  const storage = createMemoryStorage()

  const app = createApp({
    config,
    storage,
    db: {
      tokensDb: db.tokensDb,
      ownershipDb: db.ownershipDb,
      commitsDb: db.commitsDb,
      depotsDb: db.depotsDb,
      refCountDb: db.refCountDb,
      usageDb: db.usageDb,
      userRolesDb: db.userRolesDb,
      awpPendingDb: db.awpPendingDb,
      awpPubkeysDb: db.awpPubkeysDb,
    },
  })

  const reset = () => {
    db.clearAll()
  }

  const helpers: TestHelpers = {
    createTestUser: async (userId: string, role: "admin" | "authorized" = "authorized") => {
      await db.userRolesDb.setRole(userId, role)
      const userToken = await db.tokensDb.createUserToken(userId, "test-refresh-token", 3600)
      const tokenId = extractTokenId(userToken.pk)
      return {
        userId,
        token: tokenId,
        realm: `usr_${userId}`,
      }
    },

    createTestTicket: async (
      realm: string,
      issuerId: string,
      options?: { scope?: string[]; commit?: { quota?: number } }
    ) => {
      const ticket = await db.tokensDb.createTicket(realm, issuerId, options)
      const ticketId = extractTokenId(ticket.pk)
      return {
        ticketId,
        ticket: { realm, issuerId },
      }
    },

    authRequest: async (token: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      }
      if (body !== undefined) {
        headers["Content-Type"] = "application/json"
      }
      const request = new Request(`http://localhost${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      return app.fetch(request)
    },
  }

  return { app, db, storage, config, reset, helpers }
}

// ============================================================================
// Test Server
// ============================================================================

export type TestServer = TestApp & {
  url: string
  stop: () => void
}

/**
 * Start a test server with in-memory databases and storage
 */
export const startTestServer = (
  options: CreateTestAppOptions & { port?: number } = {}
): TestServer => {
  const testApp = createTestApp(options)
  const port = options.port ?? 0

  const server = Bun.serve({
    fetch: testApp.app.fetch,
    port,
  })

  const url = `http://localhost:${server.port}`

  return {
    ...testApp,
    url,
    stop: () => server.stop(),
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

if (import.meta.main) {
  const args = Bun.argv.slice(2)
  let port = 3560

  for (let i = 0; i < args.length; i++) {
    const nextArg = args[i + 1]
    if (args[i] === "--port" && nextArg) {
      port = Number.parseInt(nextArg, 10)
    }
  }

  const testApp = createTestApp()

  const server = Bun.serve({
    fetch: testApp.app.fetch,
    port,
  })

  console.log(`🧪 CASFA v2 Test Server running at http://localhost:${server.port}`)
  console.log("   Using in-memory databases and storage")
  console.log("")
  console.log("   Press Ctrl+C to stop")
}
