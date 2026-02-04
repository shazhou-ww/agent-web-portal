/**
 * E2E Tests: Realm API
 *
 * Tests for Realm basic endpoints:
 * - GET /api/realm/{realmId} - Realm endpoint info
 * - GET /api/realm/{realmId}/usage - Usage statistics
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Realm API", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/realm/{realmId}", () => {
    it("should return realm endpoint info", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        realm: string;
        nodeLimit: number;
        maxNameBytes: number;
      };

      expect(data.realm).toBe(realm);
      expect(data.nodeLimit).toBeGreaterThan(0);
      expect(data.maxNameBytes).toBeGreaterThan(0);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test`);

      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/usr_${userId2}`);

      expect(response.status).toBe(403);
    });
  });

  describe("GET /api/realm/{realmId}/usage", () => {
    it("should return usage statistics", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        realm: string;
        physicalBytes: number;
        logicalBytes: number;
        nodeCount: number;
        quotaLimit: number;
        updatedAt: number;
      };

      expect(data.realm).toBe(realm);
      expect(typeof data.physicalBytes).toBe("number");
      expect(typeof data.logicalBytes).toBe("number");
      expect(typeof data.nodeCount).toBe("number");
      expect(typeof data.quotaLimit).toBe("number");
      expect(typeof data.updatedAt).toBe("number");
    });

    it("should return zero usage for new realm", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/usage`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        physicalBytes: number;
        nodeCount: number;
      };

      expect(data.physicalBytes).toBe(0);
      expect(data.nodeCount).toBe(0);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/usage`);

      expect(response.status).toBe(401);
    });

    it("should reject access to other users realm", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/usr_${userId2}/usage`);

      expect(response.status).toBe(403);
    });
  });

  describe("Authentication Methods", () => {
    it("should accept Bearer token authentication", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");

      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      expect(response.status).toBe(200);
    });

    it("should accept Agent token authentication", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create agent token
      const createResponse = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Test Agent" }),
      });

      const { token: agentToken } = (await createResponse.json()) as { token: string };

      // Use agent token
      const response = await fetch(`${ctx.baseUrl}/api/realm/${realm}`, {
        headers: { Authorization: `Agent ${agentToken}` },
      });

      expect(response.status).toBe(200);
    });
  });
});
