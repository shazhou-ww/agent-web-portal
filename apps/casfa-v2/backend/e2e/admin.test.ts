/**
 * E2E Tests: Admin API
 *
 * Tests for admin user management endpoints:
 * - GET /api/admin/users
 * - PATCH /api/admin/users/:userId
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Admin API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/admin/users", () => {
    it("should list all users for admin", async () => {
      const adminId = `admin-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(adminId, "admin");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/admin/users");

      expect(response.status).toBe(200);
      const data = (await response.json()) as { users: unknown[] };
      expect(data.users).toBeInstanceOf(Array);
    });

    it("should reject non-admin users", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/admin/users");

      expect(response.status).toBe(403);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/admin/users`);

      expect(response.status).toBe(401);
    });
  });

  describe("PATCH /api/admin/users/:userId", () => {
    it("should update user role to authorized", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      const authFetch = createAuthFetcher(ctx.baseUrl, adminToken);

      // Create target user as unauthorized first
      await ctx.db.userRolesDb.setRole(targetUserId, "unauthorized");

      const response = await authFetch(`/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "authorized" }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { userId: string; role: string };
      expect(data.role).toBe("authorized");
    });

    it("should update user role to admin", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(targetUserId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, adminToken);

      const response = await authFetch(`/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "admin" }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { userId: string; role: string };
      expect(data.role).toBe("admin");
    });

    it("should revoke user access by setting role to unauthorized", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      await ctx.helpers.createTestUser(targetUserId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, adminToken);

      const response = await authFetch(`/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "unauthorized" }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { userId: string; role: string };
      expect(data.role).toBe("unauthorized");
    });

    it("should reject invalid role", async () => {
      const adminId = `admin-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token: adminToken } = await ctx.helpers.createTestUser(adminId, "admin");
      const authFetch = createAuthFetcher(ctx.baseUrl, adminToken);

      const response = await authFetch(`/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "invalid_role" }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject non-admin users", async () => {
      const userId = `user-${uniqueId()}`;
      const targetUserId = `target-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/admin/users/user:${targetUserId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "authorized" }),
      });

      expect(response.status).toBe(403);
    });
  });
});
