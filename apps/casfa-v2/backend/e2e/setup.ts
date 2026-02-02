/**
 * E2E Test Setup
 *
 * Shared setup and utilities for e2e tests.
 */

import { createTestApp, startTestServer, type TestApp, type TestServer } from "../test-server.ts"

export { createTestApp, startTestServer, type TestApp, type TestServer }

/**
 * E2E test context - provides isolated test environment
 */
export type E2EContext = {
  server: TestServer
  baseUrl: string
  helpers: TestServer["helpers"]
  db: TestServer["db"]
  cleanup: () => void
}

/**
 * Create an E2E test context
 */
export const createE2EContext = (): E2EContext => {
  const server = startTestServer()

  return {
    server,
    baseUrl: server.url,
    helpers: server.helpers,
    db: server.db,
    cleanup: () => {
      server.stop()
    },
  }
}

/**
 * Fetch helper with base URL
 */
export const createFetcher = (baseUrl: string) => {
  return async (path: string, options?: RequestInit) => {
    return fetch(`${baseUrl}${path}`, options)
  }
}

/**
 * Authenticated fetch helper
 */
export const createAuthFetcher = (baseUrl: string, token: string) => {
  return async (path: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers)
    headers.set("Authorization", `Bearer ${token}`)

    return fetch(`${baseUrl}${path}`, {
      ...options,
      headers,
    })
  }
}
