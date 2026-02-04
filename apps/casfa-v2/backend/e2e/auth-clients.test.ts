/**
 * E2E Tests: Client Authentication
 *
 * Tests for Client (P256 public key) management endpoints:
 * - POST /api/auth/clients/init
 * - GET /api/auth/clients/:clientId
 * - POST /api/auth/clients/complete
 * - GET /api/auth/clients
 * - DELETE /api/auth/clients/:clientId
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Client Authentication", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/auth/clients/init", () => {
    it("should initialize client auth flow", async () => {
      const testPubkey = `test-pubkey-${uniqueId()}`;

      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        clientId: string;
        authUrl: string;
        displayCode: string;
        expiresIn: number;
        pollInterval: number;
      };
      expect(data.clientId).toBeDefined();
      expect(data.clientId).toMatch(/^client:/);
      expect(data.authUrl).toBeDefined();
      expect(data.displayCode).toBeDefined();
      expect(data.expiresIn).toBeGreaterThan(0);
      expect(data.pollInterval).toBeGreaterThan(0);
    });

    it("should reject missing pubkey", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientName: "Test Client",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject missing clientName", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: `test-pubkey-${uniqueId()}`,
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("GET /api/auth/clients/:clientId", () => {
    it("should return pending status for pending auth", async () => {
      const testPubkey = `test-pubkey-${uniqueId()}`;

      // First init the auth flow
      const initResponse = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { clientId: string };

      // Check status using clientId
      const response = await fetch(
        `${ctx.baseUrl}/api/auth/clients/${encodeURIComponent(initData.clientId)}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { status: string; clientId: string };
      expect(data.status).toBe("pending");
      expect(data.clientId).toBe(initData.clientId);
    });

    it("should return 404 for non-existent clientId", async () => {
      const response = await fetch(
        `${ctx.baseUrl}/api/auth/clients/client:NONEXISTENT00000000000000`
      );

      expect(response.status).toBe(404);
      const data = (await response.json()) as { status: string; error?: string };
      expect(data.status).toBe("not_found");
    });
  });

  describe("POST /api/auth/clients/complete", () => {
    it("should complete client authorization", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow
      const initResponse = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { clientId: string; displayCode: string };

      // Complete authorization
      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      const response = await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: initData.clientId,
          verificationCode: initData.displayCode,
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        success: boolean;
        clientId: string;
        expiresAt: number;
      };
      expect(data.success).toBe(true);
      expect(data.clientId).toBe(initData.clientId);
      expect(data.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should reject invalid verification code", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow
      const initResponse = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { clientId: string };

      // Try to complete with wrong code
      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      const response = await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: initData.clientId,
          verificationCode: "WRONG",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: "client:SOMECLIENTID00000000000",
          verificationCode: "SOME",
        }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/auth/clients", () => {
    it("should list authorized clients", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init and complete auth flow
      const initResponse = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { clientId: string; displayCode: string };

      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: initData.clientId,
          verificationCode: initData.displayCode,
        }),
      });

      // List clients
      const response = await authFetch("/api/auth/clients");

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        items: Array<{ clientId: string; clientName: string }>;
      };
      expect(data.items).toBeInstanceOf(Array);
      expect(data.items.length).toBeGreaterThan(0);
      expect(data.items.some((c) => c.clientId === initData.clientId)).toBe(true);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients`);

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/auth/clients/:clientId", () => {
    it("should revoke authorized client", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init and complete auth flow
      const initResponse = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          clientName: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { clientId: string; displayCode: string };

      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: initData.clientId,
          verificationCode: initData.displayCode,
        }),
      });

      // Revoke client using clientId
      const response = await authFetch(
        `/api/auth/clients/${encodeURIComponent(initData.clientId)}`,
        {
          method: "DELETE",
        }
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data.success).toBe(true);
    });

    it("should return 404 for non-existent client", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/auth/clients/client:NONEXISTENT00000000000000`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });
  });
});
