/**
 * E2E Tests: Authentication
 *
 * Note: These tests use unique user IDs per test to avoid conflicts
 * since DynamoDB Local persists data between test runs.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext } from "./setup.ts";

/** Generate a unique test ID */
const uniqueId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("Authentication", () => {
  let ctx: E2EContext;

  beforeAll(() => {
    ctx = createE2EContext();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("Protected Routes", () => {
    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`);

      expect(response.status).toBe(401);
    });

    it("should accept authenticated requests", async () => {
      const userId = `test-user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId);
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user-1-${uniqueId()}`;
      const userId2 = `user-2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1);
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Try to access another user's realm
      const response = await authFetch(`/api/realm/usr_${userId2}/usage`);

      expect(response.status).toBe(403);
    });
  });

  describe("User Roles", () => {
    it("should allow authorized users to access their realm", async () => {
      const userId = `authorized-user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
    });

    it("should allow admin users to access admin endpoints", async () => {
      const userId = `admin-user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "admin");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/admin/users");

      expect(response.status).toBe(200);
    });

    it("should reject non-admin users from admin endpoints", async () => {
      const userId = `regular-user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/admin/users");

      expect(response.status).toBe(403);
    });
  });
});
