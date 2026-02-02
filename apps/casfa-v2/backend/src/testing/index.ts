/**
 * Testing utilities for casfa-v2
 *
 * This module provides in-memory database implementations and test helpers
 * for running tests without DynamoDB or S3 dependencies.
 *
 * @example
 * ```ts
 * import { createTestApp } from "./testing"
 *
 * const { app, db, helpers, reset } = createTestApp()
 *
 * // Create a test user
 * const { userId, token, realm } = await helpers.createTestUser("test-user")
 *
 * // Make authenticated requests
 * const response = await helpers.authRequest(token, "GET", `/api/realm/${realm}`)
 *
 * // Reset databases between tests
 * reset()
 * ```
 */

// Memory DB implementations
export {
  createMemoryTokensDb,
  createMemoryCommitsDb,
  createMemoryOwnershipDb,
  createMemoryRefCountDb,
  createMemoryUsageDb,
  createMemoryUserRolesDb,
  createMemoryDepotsDb,
  createMemoryAwpPendingDb,
  createMemoryAwpPubkeysDb,
  createAllMemoryDbs,
  type AllDbs,
} from "./memory-db/index.ts"

// Test app factory
export {
  createTestApp,
  createTestConfig,
  startTestServer,
  type TestApp,
  type TestServer,
  type TestHelpers,
  type CreateTestAppOptions,
} from "./test-app.ts"
