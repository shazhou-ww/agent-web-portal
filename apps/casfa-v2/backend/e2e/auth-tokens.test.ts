/**
 * E2E Tests: Agent Token Management
 *
 * Tests for Agent Token endpoints:
 * - POST /api/auth/tokens
 * - GET /api/auth/tokens
 * - DELETE /api/auth/tokens/:id
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Agent Token Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/auth/tokens", () => {
    it("should create an Agent Token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "My AI Agent",
          description: "Test agent token",
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as {
        id: string;
        token: string;
        name: string;
        description?: string;
        expiresAt: number;
        createdAt: number;
      };

      expect(data.id).toMatch(/^token:/);
      expect(data.token).toMatch(/^casfa_/);
      expect(data.name).toBe("My AI Agent");
      expect(data.description).toBe("Test agent token");
      expect(data.expiresAt).toBeGreaterThan(Date.now());
      expect(data.createdAt).toBeLessThanOrEqual(Date.now());
    });

    it("should create Agent Token with custom expiration", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const expiresIn = 3600; // 1 hour
      const response = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Short-lived Token",
          expiresIn,
        }),
      });

      expect(response.status).toBe(201);
      const data = (await response.json()) as { expiresAt: number };

      // Check expiration is approximately 1 hour from now
      const expectedExpiry = Date.now() + expiresIn * 1000;
      expect(data.expiresAt).toBeGreaterThan(expectedExpiry - 5000);
      expect(data.expiresAt).toBeLessThan(expectedExpiry + 5000);
    });

    it("should reject missing name", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "No name provided",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject empty name", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Unauthorized Token",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/auth/tokens", () => {
    it("should list user tokens", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a few tokens
      await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Token 1" }),
      });

      await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Token 2" }),
      });

      // List tokens
      const response = await authFetch("/api/auth/tokens");

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        tokens: Array<{
          id: string;
          name: string;
          description?: string;
          expiresAt: number;
          createdAt: number;
        }>;
      };

      expect(data.tokens).toBeInstanceOf(Array);
      expect(data.tokens.length).toBeGreaterThanOrEqual(2);

      // Token value should NOT be included in list
      for (const t of data.tokens) {
        expect(t).not.toHaveProperty("token");
      }
    });

    it("should return empty list for new user", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/auth/tokens");

      expect(response.status).toBe(200);
      const data = (await response.json()) as { tokens: unknown[] };
      expect(data.tokens).toBeInstanceOf(Array);
      expect(data.tokens.length).toBe(0);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens`);

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/auth/tokens/:id", () => {
    it("should revoke token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a token
      const createResponse = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Token to Revoke" }),
      });

      const { id: tokenId } = (await createResponse.json()) as { id: string };

      // Revoke the token
      const response = await authFetch(`/api/auth/tokens/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify token is no longer in list
      const listResponse = await authFetch("/api/auth/tokens");
      const listData = (await listResponse.json()) as { tokens: Array<{ id: string }> };
      const revokedToken = listData.tokens.find((t) => t.id === tokenId);
      expect(revokedToken).toBeUndefined();
    });

    it("should return 404 for non-existent token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch("/api/auth/tokens/token:NONEXISTENT0000000000000000", {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/tokens/token:SOMETOKEN`, {
        method: "DELETE",
      });

      expect(response.status).toBe(401);
    });
  });

  describe("Agent Token Authentication", () => {
    it("should authenticate with Agent Token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create an Agent Token
      const createResponse = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Auth Test Token" }),
      });

      const { token: agentToken } = (await createResponse.json()) as { token: string };

      // Use Agent Token to access realm
      const response = await ctx.helpers.agentRequest(
        agentToken,
        "GET",
        `/api/realm/${realm}/usage`
      );

      expect(response.status).toBe(200);
    });
  });
});
