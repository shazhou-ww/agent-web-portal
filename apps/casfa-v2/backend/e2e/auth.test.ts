/**
 * E2E Tests: Authentication
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test"
import { createE2EContext, createAuthFetcher, type E2EContext } from "./setup.ts"

describe("Authentication", () => {
  let ctx: E2EContext

  beforeAll(() => {
    ctx = createE2EContext()
  })

  afterAll(() => {
    ctx.cleanup()
  })

  beforeEach(() => {
    ctx.db.clearAll()
  })

  describe("Protected Routes", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`)

      expect(response.status).toBe(401)
    })

    it("should accept authenticated requests", async () => {
      const { token, realm } = await ctx.helpers.createTestUser("test-user")
      const authFetch = createAuthFetcher(ctx.baseUrl, token)

      const response = await authFetch(`/api/realm/${realm}/usage`)

      expect(response.status).toBe(200)
    })

    it("should reject access to other users realm", async () => {
      const { token } = await ctx.helpers.createTestUser("user-1")
      const authFetch = createAuthFetcher(ctx.baseUrl, token)

      // Try to access another user's realm
      const response = await authFetch("/api/realm/usr_user-2/usage")

      expect(response.status).toBe(403)
    })
  })

  describe("User Roles", () => {
    it("should allow authorized users to access their realm", async () => {
      const { token, realm } = await ctx.helpers.createTestUser("authorized-user", "authorized")
      const authFetch = createAuthFetcher(ctx.baseUrl, token)

      const response = await authFetch(`/api/realm/${realm}/usage`)

      expect(response.status).toBe(200)
    })

    it("should allow admin users to access admin endpoints", async () => {
      const { token } = await ctx.helpers.createTestUser("admin-user", "admin")
      const authFetch = createAuthFetcher(ctx.baseUrl, token)

      const response = await authFetch("/api/admin/users")

      expect(response.status).toBe(200)
    })

    it("should reject non-admin users from admin endpoints", async () => {
      const { token } = await ctx.helpers.createTestUser("regular-user", "authorized")
      const authFetch = createAuthFetcher(ctx.baseUrl, token)

      const response = await authFetch("/api/admin/users")

      expect(response.status).toBe(403)
    })
  })
})
