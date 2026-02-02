/**
 * Test App Factory
 *
 * Creates a fully-functional Hono app with in-memory databases and storage
 * for testing purposes. No DynamoDB or S3 dependencies required.
 */

import type { Hono } from "hono"
import { createMemoryStorage } from "@agent-web-portal/cas-storage-memory"
import type { StorageProvider } from "@agent-web-portal/cas-storage-core"
import { createApp, type AppOptions, type DbInstances } from "../app.ts"
import type { AppConfig, ServerConfig, CognitoConfig } from "../config.ts"
import type { Env } from "../types.ts"
import { createAllMemoryDbs, type AllDbs } from "./memory-db/index.ts"
import { extractTokenId } from "../util/token-id.ts"

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
// Test App
// ============================================================================

export type TestApp = {
  /**
   * The Hono app instance
   */
  app: Hono<Env>

  /**
   * All in-memory database instances
   */
  db: AllDbs & { clearAll: () => void }

  /**
   * In-memory storage instance
   */
  storage: StorageProvider

  /**
   * Test configuration
   */
  config: AppConfig

  /**
   * Reset all databases and storage
   */
  reset: () => void

  /**
   * Helper to make authenticated requests
   */
  helpers: TestHelpers
}

export type TestHelpers = {
  /**
   * Create a test user with a token
   */
  createTestUser: (userId: string, role?: "admin" | "authorized") => Promise<{
    userId: string
    token: string
    realm: string
  }>

  /**
   * Create a test ticket for a realm
   */
  createTestTicket: (
    realm: string,
    issuerId: string,
    options?: { scope?: string[]; commit?: { quota?: number } }
  ) => Promise<{
    ticketId: string
    ticket: { realm: string; issuerId: string }
  }>

  /**
   * Make an authenticated request
   */
  authRequest: (
    token: string,
    method: string,
    path: string,
    body?: unknown
  ) => Promise<Response>
}

export type CreateTestAppOptions = {
  config?: Partial<AppConfig>
}

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
    // Note: createMemoryStorage() creates a new instance each time,
    // so we can't clear it. Tests should create new test app if needed.
  }

  // Helper functions
  const helpers: TestHelpers = {
    createTestUser: async (userId: string, role: "admin" | "authorized" = "authorized") => {
      // Set user role
      await db.userRolesDb.setRole(userId, role)

      // Create user token
      const userToken = await db.tokensDb.createUserToken(
        userId,
        "test-refresh-token",
        3600
      )

      const tokenId = extractTokenId(userToken.pk)

      return {
        userId,
        token: tokenId,
        // realm format matches auth middleware: usr_{userId}
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

    authRequest: async (
      token: string,
      method: string,
      path: string,
      body?: unknown
    ) => {
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

  return {
    app,
    db,
    storage,
    config,
    reset,
    helpers,
  }
}

// ============================================================================
// Test Server
// ============================================================================

export type TestServer = TestApp & {
  /**
   * The server URL
   */
  url: string

  /**
   * Stop the test server
   */
  stop: () => void
}

/**
 * Start a test server with in-memory databases and storage
 */
export const startTestServer = (
  options: CreateTestAppOptions & { port?: number } = {}
): TestServer => {
  const testApp = createTestApp(options)
  const port = options.port ?? 0 // 0 = random available port

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
