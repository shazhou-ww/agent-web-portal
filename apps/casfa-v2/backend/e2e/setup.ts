/**
 * E2E Test Setup
 *
 * Shared setup and utilities for e2e tests.
 *
 * Requirements:
 * - DynamoDB Local running at DYNAMODB_ENDPOINT (default: http://localhost:8000)
 * - Test tables created in DynamoDB Local
 *
 * Environment variables (set automatically by this module if not already set):
 * - DYNAMODB_ENDPOINT: http://localhost:8000
 * - STORAGE_TYPE: memory
 * - MOCK_JWT_SECRET: test-secret-key-for-e2e
 */

import { rmSync } from "node:fs";
import type { StorageProvider } from "@agent-web-portal/cas-storage-core";
import { createFsStorage } from "@agent-web-portal/cas-storage-fs";
import { createMemoryStorage } from "@agent-web-portal/cas-storage-memory";
import type { Server } from "bun";
import { createApp, createNodeHashProvider, type DbInstances } from "../src/app.ts";
import { createMockJwt } from "../src/auth/index.ts";
import { createMockJwtVerifier } from "../src/auth/jwt-verifier.ts";
import { type AppConfig, loadConfig } from "../src/config.ts";

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
} from "../src/db/index.ts";

// Auth service
import { type AuthService, createAuthService } from "../src/services/auth.ts";

// ============================================================================
// Test Utilities
// ============================================================================

/** Generate a unique test ID */
export const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// ============================================================================
// Test Configuration
// ============================================================================

/** Default test configuration */
const TEST_CONFIG = {
  DYNAMODB_ENDPOINT: "http://localhost:8000",
  STORAGE_TYPE: "memory" as const,
  STORAGE_FS_PATH: "./test-storage",
  MOCK_JWT_SECRET: "test-secret-key-for-e2e",
};

/**
 * Set test environment variables if not already set
 */
export const setupTestEnv = () => {
  process.env.DYNAMODB_ENDPOINT ??= TEST_CONFIG.DYNAMODB_ENDPOINT;
  process.env.STORAGE_TYPE ??= TEST_CONFIG.STORAGE_TYPE;
  process.env.MOCK_JWT_SECRET ??= TEST_CONFIG.MOCK_JWT_SECRET;

  if (process.env.STORAGE_TYPE === "fs") {
    process.env.STORAGE_FS_PATH ??= TEST_CONFIG.STORAGE_FS_PATH;
  }
};

// Auto-setup test environment
setupTestEnv();

// ============================================================================
// Test Server Types
// ============================================================================

export type TestServer = {
  server: Server<unknown>;
  url: string;
  config: AppConfig;
  db: DbInstances;
  storage: StorageProvider;
  authService: AuthService;
  helpers: TestHelpers;
  stop: () => void;
};

/** Agent Token creation result */
export type AgentTokenResult = {
  id: string;
  token: string;
  name: string;
  expiresAt: number;
};

/** Ticket creation result */
export type TicketResult = {
  ticketId: string;
  realm: string;
  input?: string[];
  writable: boolean;
  expiresAt: number;
};

export type TestHelpers = {
  /** Create a mock JWT token for a user */
  createUserToken: (userId: string, options?: { exp?: number }) => string;
  /** Create an authorized user with a token */
  createTestUser: (
    userId: string,
    role?: "admin" | "authorized"
  ) => Promise<{
    userId: string;
    token: string;
    realm: string;
  }>;
  /** Make an authenticated request */
  authRequest: (token: string, method: string, path: string, body?: unknown) => Promise<Response>;
  /** Create an Agent Token for a user */
  createAgentToken: (
    token: string,
    options?: { name?: string; description?: string; expiresIn?: number }
  ) => Promise<AgentTokenResult>;
  /** Create a Ticket for a realm */
  createTicket: (
    token: string,
    realm: string,
    options?: {
      input?: string[];
      purpose?: string;
      writable?: { quota?: number; accept?: string[] };
      expiresIn?: number;
    }
  ) => Promise<TicketResult>;
  /** Make a request with Ticket authentication */
  ticketRequest: (ticketId: string, method: string, path: string, body?: unknown) => Promise<Response>;
  /** Make a request with Agent Token authentication */
  agentRequest: (agentToken: string, method: string, path: string, body?: unknown) => Promise<Response>;
};

// ============================================================================
// Test Server Factory
// ============================================================================

/**
 * Start a test server with the current environment configuration
 *
 * Uses:
 * - DynamoDB Local (via DYNAMODB_ENDPOINT)
 * - Memory or file system storage (via STORAGE_TYPE)
 * - Mock JWT authentication (via MOCK_JWT_SECRET)
 */
export const startTestServer = (options?: { port?: number }): TestServer => {
  const config = loadConfig();
  const mockJwtSecret = process.env.MOCK_JWT_SECRET ?? TEST_CONFIG.MOCK_JWT_SECRET;
  const storageType = process.env.STORAGE_TYPE ?? TEST_CONFIG.STORAGE_TYPE;
  const storageFsPath = process.env.STORAGE_FS_PATH ?? TEST_CONFIG.STORAGE_FS_PATH;

  // Create DB instances (uses DYNAMODB_ENDPOINT)
  const db: DbInstances = {
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

  // Create storage
  const storage =
    storageType === "fs"
      ? createFsStorage({ basePath: storageFsPath, prefix: config.storage.prefix })
      : createMemoryStorage();

  // Create JWT verifier
  const jwtVerifier = createMockJwtVerifier(mockJwtSecret);

  // Create auth service
  const authService = createAuthService({
    tokensDb: db.tokensDb,
    userRolesDb: db.userRolesDb,
    cognitoConfig: config.cognito,
  });

  // Create hash provider
  const hashProvider = createNodeHashProvider();

  // Create app
  const app = createApp({
    config,
    db,
    storage,
    authService,
    hashProvider,
    jwtVerifier,
  });

  // Start server
  const port = options?.port ?? 0;
  const server = Bun.serve({
    fetch: app.fetch,
    port,
  });

  const url = `http://localhost:${server.port}`;

  // Test helpers
  const helpers: TestHelpers = {
    createUserToken: (userId: string, options?: { exp?: number }) => {
      const exp = options?.exp ?? Math.floor(Date.now() / 1000) + 3600; // 1 hour default
      return createMockJwt(mockJwtSecret, { sub: userId, exp });
    },

    createTestUser: async (userId: string, role: "admin" | "authorized" = "authorized") => {
      // Set user role in database
      await db.userRolesDb.setRole(userId, role);

      // Create JWT token
      const token = helpers.createUserToken(userId);

      return {
        userId,
        token,
        realm: `usr_${userId}`,
      };
    },

    authRequest: async (token: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },

    createAgentToken: async (token: string, options = {}) => {
      const { name = "Test Agent Token", description, expiresIn } = options;
      const response = await helpers.authRequest(token, "POST", "/api/auth/tokens", {
        name,
        description,
        expiresIn,
      });

      if (!response.ok) {
        throw new Error(`Failed to create agent token: ${response.status}`);
      }

      const data = (await response.json()) as AgentTokenResult;
      return data;
    },

    createTicket: async (token: string, realm: string, options = {}) => {
      const { input, purpose, writable, expiresIn } = options;
      const response = await helpers.authRequest(token, "POST", `/api/realm/${realm}/tickets`, {
        input,
        purpose,
        writable,
        expiresIn,
      });

      if (!response.ok) {
        throw new Error(`Failed to create ticket: ${response.status}`);
      }

      const data = (await response.json()) as TicketResult;
      return data;
    },

    ticketRequest: async (ticketId: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Ticket ${ticketId}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },

    agentRequest: async (agentToken: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = {
        Authorization: `Agent ${agentToken}`,
      };
      if (body !== undefined) {
        headers["Content-Type"] = "application/json";
      }
      const request = new Request(`${url}${path}`, {
        method,
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      return app.fetch(request);
    },
  };

  const stop = () => {
    server.stop();
    // Clean up file storage if used
    if (storageType === "fs" && storageFsPath) {
      try {
        rmSync(storageFsPath, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  };

  return {
    server,
    url,
    config,
    db,
    storage,
    authService,
    helpers,
    stop,
  };
};

// ============================================================================
// E2E Context
// ============================================================================

/**
 * E2E test context - provides isolated test environment
 */
export type E2EContext = {
  server: TestServer;
  baseUrl: string;
  helpers: TestHelpers;
  db: DbInstances;
  cleanup: () => void;
};

/**
 * Create an E2E test context
 */
export const createE2EContext = (): E2EContext => {
  const server = startTestServer();

  return {
    server,
    baseUrl: server.url,
    helpers: server.helpers,
    db: server.db,
    cleanup: () => {
      server.stop();
    },
  };
};

// ============================================================================
// Fetch Helpers
// ============================================================================

/**
 * Fetch helper with base URL
 */
export const createFetcher = (baseUrl: string) => {
  return async (path: string, options?: RequestInit) => {
    return fetch(`${baseUrl}${path}`, options);
  };
};

/**
 * Authenticated fetch helper
 */
export const createAuthFetcher = (baseUrl: string, token: string) => {
  return async (path: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers);
    headers.set("Authorization", `Bearer ${token}`);

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    });
  };
};
