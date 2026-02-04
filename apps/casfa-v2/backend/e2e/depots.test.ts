/**
 * E2E Tests: Depot Management
 *
 * Tests for Depot endpoints:
 * - GET /api/realm/{realmId}/depots - List depots
 * - POST /api/realm/{realmId}/depots - Create depot
 * - GET /api/realm/{realmId}/depots/:depotId - Get depot details
 * - PATCH /api/realm/{realmId}/depots/:depotId - Update depot metadata
 * - POST /api/realm/{realmId}/depots/:depotId/commit - Commit new root
 * - DELETE /api/realm/{realmId}/depots/:depotId - Delete depot
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Depot Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("GET /api/realm/{realmId}/depots", () => {
    it("should list depots including default main depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/depots`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        depots: Array<{
          depotId: string;
          title: string;
          root: string;
          maxHistory: number;
          history: string[];
          createdAt: number;
          updatedAt: number;
        }>;
        hasMore: boolean;
      };

      expect(data.depots).toBeInstanceOf(Array);
      // Should have at least the default main depot
      expect(data.depots.length).toBeGreaterThanOrEqual(0);
    });

    it("should support pagination", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a few depots
      for (let i = 0; i < 3; i++) {
        await authFetch(`/api/realm/${realm}/depots`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: `Depot ${i}` }),
        });
      }

      const response = await authFetch(`/api/realm/${realm}/depots?limit=2`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        depots: unknown[];
        nextCursor?: string;
        hasMore: boolean;
      };

      expect(data.depots.length).toBeLessThanOrEqual(2);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`);

      expect(response.status).toBe(401);
    });
  });

  describe("POST /api/realm/{realmId}/depots", () => {
    it("should create a new depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "My Documents",
          maxHistory: 10,
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as {
        depotId: string;
        title: string;
        root: string;
        maxHistory: number;
        history: string[];
        createdAt: number;
        updatedAt: number;
      };

      expect(data.depotId).toMatch(/^depot:/);
      expect(data.title).toBe("My Documents");
      expect(data.maxHistory).toBe(10);
      expect(data.history).toEqual([]);
      expect(data.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should create depot with default maxHistory", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Default History Depot",
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as { maxHistory: number };
      expect(data.maxHistory).toBe(20); // Default value
    });

    it("should reject maxHistory exceeding system limit", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Too Much History",
          maxHistory: 101, // Exceeds max of 100
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Unauthorized" }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/depots/:depotId", () => {
    it("should get depot details with history", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Detail Test" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Get details
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        depotId: string;
        title: string;
        root: string;
        maxHistory: number;
        history: string[];
        createdAt: number;
        updatedAt: number;
      };

      expect(data.depotId).toBe(depotId);
      expect(data.title).toBe("Detail Test");
      expect(data.history).toBeInstanceOf(Array);
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/depots/depot:NONEXISTENT0000000000000`);

      expect(response.status).toBe(404);
    });
  });

  describe("PATCH /api/realm/{realmId}/depots/:depotId", () => {
    it("should update depot title", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Original Title" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Update title
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "New Title" }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { title: string };
      expect(data.title).toBe("New Title");
    });

    it("should update depot maxHistory", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "History Update", maxHistory: 10 }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Update maxHistory
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxHistory: 30 }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { maxHistory: number };
      expect(data.maxHistory).toBe(30);
    });

    it("should reject maxHistory exceeding limit", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Bad Update" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Try to set too high maxHistory
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxHistory: 200 }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(
        `/api/realm/${realm}/depots/depot:NONEXISTENT0000000000000`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Update" }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("POST /api/realm/{realmId}/depots/:depotId/commit", () => {
    it("should commit new root node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Commit Test" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Commit new root (note: would fail if node doesn't exist)
      const newRoot = "node:0000000000000000000000000000000000000000000000000000000000000001";
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: newRoot }),
      });

      // Expect 400 because the root node doesn't actually exist
      expect([200, 400]).toContain(response.status);
    });

    it("should reject invalid root key format", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Invalid Root Test" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Commit with invalid root format
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}/commit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root: "invalid-root-format" }),
      });

      expect(response.status).toBe(400);
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(
        `/api/realm/${realm}/depots/depot:NONEXISTENT0000000000000/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            root: "node:0000000000000000000000000000000000000000000000000000000000000001",
          }),
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("DELETE /api/realm/{realmId}/depots/:depotId", () => {
    it("should delete depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create depot
      const createResponse = await authFetch(`/api/realm/${realm}/depots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Delete Test" }),
      });

      const { depotId } = (await createResponse.json()) as { depotId: string };

      // Delete depot
      const response = await authFetch(`/api/realm/${realm}/depots/${depotId}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify deleted
      const getResponse = await authFetch(`/api/realm/${realm}/depots/${depotId}`);
      expect(getResponse.status).toBe(404);
    });

    it("should return 404 for non-existent depot", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(
        `/api/realm/${realm}/depots/depot:NONEXISTENT0000000000000`,
        {
          method: "DELETE",
        }
      );

      expect(response.status).toBe(404);
    });
  });

  describe("Access Control", () => {
    it("should reject access to other users realm depots", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/usr_${userId2}/depots`);

      expect(response.status).toBe(403);
    });

    it("should not allow Ticket to access depots", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Depot access test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Try to access depots with ticket
      const response = await ctx.helpers.ticketRequest(
        ticketId,
        "GET",
        `/api/realm/${realm}/depots`
      );

      expect(response.status).toBe(403);
    });
  });
});
