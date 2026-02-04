/**
 * E2E Tests: AWP Client Authentication
 *
 * Tests for AWP (Agent Web Portal) client management endpoints:
 * - POST /api/auth/clients/init
 * - GET /api/auth/clients/status
 * - POST /api/auth/clients/complete
 * - GET /api/auth/clients
 * - DELETE /api/auth/clients/:pubkey
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("AWP Client Authentication", () => {
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
          client_name: "Test Client",
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        auth_url: string;
        verification_code: string;
        expires_in: number;
        poll_interval: number;
      };
      expect(data.auth_url).toBeDefined();
      expect(data.verification_code).toBeDefined();
      expect(data.expires_in).toBeGreaterThan(0);
      expect(data.poll_interval).toBeGreaterThan(0);
    });

    it("should reject missing pubkey", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Test Client",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject missing client_name", async () => {
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

  describe("GET /api/auth/clients/status", () => {
    it("should return unauthorized status for pending auth", async () => {
      const testPubkey = `test-pubkey-${uniqueId()}`;

      // First init the auth flow
      await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          client_name: "Test Client",
        }),
      });

      // Check status
      const response = await fetch(
        `${ctx.baseUrl}/api/auth/clients/status?pubkey=${encodeURIComponent(testPubkey)}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { authorized: boolean };
      expect(data.authorized).toBe(false);
    });

    it("should return error for non-existent pending auth", async () => {
      const response = await fetch(
        `${ctx.baseUrl}/api/auth/clients/status?pubkey=${encodeURIComponent("non-existent-key")}`
      );

      expect(response.status).toBe(200);
      const data = (await response.json()) as { authorized: boolean; error?: string };
      expect(data.authorized).toBe(false);
      expect(data.error).toBeDefined();
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
          client_name: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { verification_code: string };

      // Complete authorization
      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      const response = await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          verification_code: initData.verification_code,
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean; expires_at: number };
      expect(data.success).toBe(true);
      expect(data.expires_at).toBeGreaterThan(Date.now());
    });

    it("should reject invalid verification code", async () => {
      const userId = `user-${uniqueId()}`;
      const testPubkey = `test-pubkey-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");

      // Init auth flow
      await fetch(`${ctx.baseUrl}/api/auth/clients/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          client_name: "Test Client",
        }),
      });

      // Try to complete with wrong code
      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      const response = await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          verification_code: "WRONG-CODE",
        }),
      });

      expect(response.status).toBe(400);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: "some-key",
          verification_code: "SOME-CODE",
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
          client_name: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { verification_code: string };

      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          verification_code: initData.verification_code,
        }),
      });

      // List clients
      const response = await authFetch("/api/auth/clients");

      expect(response.status).toBe(200);
      const data = (await response.json()) as { clients: unknown[] };
      expect(data.clients).toBeInstanceOf(Array);
    });

    it("should reject unauthenticated request", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/auth/clients`);

      expect(response.status).toBe(401);
    });
  });

  describe("DELETE /api/auth/clients/:pubkey", () => {
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
          client_name: "Test Client",
        }),
      });

      const initData = (await initResponse.json()) as { verification_code: string };

      const authFetch = createAuthFetcher(ctx.baseUrl, token);
      await authFetch("/api/auth/clients/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPubkey,
          verification_code: initData.verification_code,
        }),
      });

      // Revoke client
      const response = await authFetch(`/api/auth/clients/${encodeURIComponent(testPubkey)}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data.success).toBe(true);
    });

    it("should return 404 for non-existent client", async () => {
      const userId = `user-${uniqueId()}`;
      const { token } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/auth/clients/${encodeURIComponent("non-existent")}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(404);
    });
  });
});
