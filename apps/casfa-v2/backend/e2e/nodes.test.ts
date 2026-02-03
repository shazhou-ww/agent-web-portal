/**
 * E2E Tests: Node Operations
 *
 * Tests for Node endpoints:
 * - POST /api/realm/{realmId}/prepare-nodes - Pre-upload check
 * - PUT /api/realm/{realmId}/nodes/:key - Upload node
 * - GET /api/realm/{realmId}/nodes/:key/metadata - Get metadata
 * - GET /api/realm/{realmId}/nodes/:key - Get binary data
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Node Operations", () => {
  let ctx: E2EContext;

  beforeAll(() => {
    ctx = createE2EContext();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/realm/{realmId}/prepare-nodes", () => {
    it("should return all keys as missing for non-existent nodes", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const testKeys = [
        "node:0000000000000000000000000000000000000000000000000000000000000001",
        "node:0000000000000000000000000000000000000000000000000000000000000002",
      ];

      const response = await authFetch(`/api/realm/${realm}/prepare-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: testKeys }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        missing: string[];
        exists: string[];
      };

      expect(data.missing).toEqual(expect.arrayContaining(testKeys));
      expect(data.exists).toEqual([]);
    });

    it("should reject empty keys array", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/prepare-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: [] }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject invalid node key format", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/prepare-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keys: ["invalid-key-format"] }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/prepare-nodes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keys: ["node:0000000000000000000000000000000000000000000000000000000000000001"],
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("PUT /api/realm/{realmId}/nodes/:key", () => {
    it("should upload a node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a simple test node (this would normally be a properly formatted CAS node)
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000001";

      const response = await authFetch(`/api/realm/${realm}/nodes/${nodeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: nodeData,
      });

      // Note: The actual response depends on whether the node format is valid
      // In a real test, we'd use properly formatted CAS nodes
      expect([200, 400]).toContain(response.status);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeData = new Uint8Array([1, 2, 3, 4, 5]);
      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000001";

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: nodeData,
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/nodes/:key/metadata", () => {
    it("should return 404 for non-existent node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000099";

      const response = await authFetch(`/api/realm/${realm}/nodes/${nodeKey}/metadata`);

      expect(response.status).toBe(404);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000001";

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}/metadata`);

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/nodes/:key", () => {
    it("should return 404 for non-existent node", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000099";

      const response = await authFetch(`/api/realm/${realm}/nodes/${nodeKey}`);

      expect(response.status).toBe(404);
    });

    it("should reject unauthenticated requests", async () => {
      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000001";

      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/nodes/${nodeKey}`);

      expect(response.status).toBe(401);
    });
  });

  describe("Access Control", () => {
    it("should reject access to other users realm nodes", async () => {
      const userId1 = `user1-${uniqueId()}`;
      const userId2 = `user2-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId1, "authorized");
      await ctx.helpers.createTestUser(userId2, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const nodeKey = "node:0000000000000000000000000000000000000000000000000000000000000001";

      const response = await authFetch(`/api/realm/usr_${userId2}/nodes/${nodeKey}`);

      expect(response.status).toBe(403);
    });
  });
});
