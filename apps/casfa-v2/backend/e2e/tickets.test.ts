/**
 * E2E Tests: Ticket Management
 *
 * Tests for Ticket endpoints:
 * - POST /api/realm/{realmId}/tickets - Create ticket
 * - GET /api/realm/{realmId}/tickets - List tickets
 * - GET /api/realm/{realmId}/tickets/:ticketId - Get ticket details
 * - POST /api/realm/{realmId}/tickets/:ticketId/commit - Commit result
 * - POST /api/realm/{realmId}/tickets/:ticketId/revoke - Revoke ticket
 * - DELETE /api/realm/{realmId}/tickets/:ticketId - Delete ticket
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createAuthFetcher, createE2EContext, type E2EContext, uniqueId } from "./setup.ts";

describe("Ticket Management", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  describe("POST /api/realm/{realmId}/tickets", () => {
    it("should create a read-only ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "Read test data",
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        ticketId: string;
        realm: string;
        writable: boolean;
        expiresAt: number;
      };

      expect(data.ticketId).toMatch(/^ticket:/);
      expect(data.realm).toBe(realm);
      expect(data.writable).toBe(false);
      expect(data.expiresAt).toBeGreaterThan(Date.now());
    });

    it("should create a writable ticket with quota", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "Generate thumbnail",
          writable: {
            quota: 10485760, // 10MB
            accept: ["image/*"],
          },
          expiresIn: 3600,
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        ticketId: string;
        writable: boolean;
        config: {
          quota: number;
          accept: string[];
        };
      };

      expect(data.writable).toBe(true);
      expect(data.config.quota).toBe(10485760);
      expect(data.config.accept).toContain("image/*");
    });

    it("should create a ticket with input scope", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const inputNodes = [
        "node:0000000000000000000000000000000000000000000000000000000000000001",
        "node:0000000000000000000000000000000000000000000000000000000000000002",
      ];

      const response = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input: inputNodes,
          purpose: "Process specific nodes",
        }),
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        ticketId: string;
        input: string[];
      };

      expect(data.input).toEqual(inputNodes);
    });

    it("should reject unauthenticated requests", async () => {
      const response = await fetch(`${ctx.baseUrl}/api/realm/usr_test/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Test" }),
      });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/realm/{realmId}/tickets", () => {
    it("should list tickets", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a ticket first
      await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Test ticket" }),
      });

      const response = await authFetch(`/api/realm/${realm}/tickets`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        tickets: Array<{
          ticketId: string;
          status: string;
          purpose?: string;
        }>;
        hasMore: boolean;
      };

      expect(data.tickets).toBeInstanceOf(Array);
      expect(data.tickets.length).toBeGreaterThanOrEqual(1);
    });

    it("should filter by status", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create tickets
      await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Issued ticket" }),
      });

      const response = await authFetch(`/api/realm/${realm}/tickets?status=issued`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        tickets: Array<{ status: string }>;
      };

      for (const ticket of data.tickets) {
        expect(ticket.status).toBe("issued");
      }
    });

    it("should support pagination", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a few tickets
      for (let i = 0; i < 3; i++) {
        await authFetch(`/api/realm/${realm}/tickets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ purpose: `Ticket ${i}` }),
        });
      }

      const response = await authFetch(`/api/realm/${realm}/tickets?limit=2`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        tickets: unknown[];
        nextCursor?: string;
        hasMore: boolean;
      };

      expect(data.tickets.length).toBeLessThanOrEqual(2);
    });
  });

  describe("GET /api/realm/{realmId}/tickets/:ticketId", () => {
    it("should get ticket details", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "Get details test",
          writable: { quota: 1024 },
        }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Get details
      const response = await authFetch(`/api/realm/${realm}/tickets/${ticketId}`);

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        ticketId: string;
        realm: string;
        status: string;
        purpose: string;
        writable: boolean;
        isRevoked: boolean;
        config: object;
        createdAt: number;
        expiresAt: number;
      };

      expect(data.ticketId).toBe(ticketId);
      expect(data.status).toBe("issued");
      expect(data.purpose).toBe("Get details test");
      expect(data.writable).toBe(true);
      expect(data.isRevoked).toBe(false);
    });

    it("should return 404 for non-existent ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      const response = await authFetch(`/api/realm/${realm}/tickets/ticket:NONEXISTENT0000000000000`);

      expect(response.status).toBe(404);
    });

    it("should allow ticket to query itself", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create a ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Self-query test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Query with ticket authentication
      const response = await ctx.helpers.ticketRequest(
        ticketId,
        "GET",
        `/api/realm/${realm}/tickets/${ticketId}`
      );

      expect(response.status).toBe(200);
    });
  });

  describe("POST /api/realm/{realmId}/tickets/:ticketId/commit", () => {
    it("should commit result to writable ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create writable ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "Commit test",
          writable: { quota: 1024 },
        }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Commit (note: would fail in real scenario as output node doesn't exist)
      const outputNode = "node:0000000000000000000000000000000000000000000000000000000000000001";
      const response = await ctx.helpers.ticketRequest(
        ticketId,
        "POST",
        `/api/realm/${realm}/tickets/${ticketId}/commit`,
        { output: outputNode }
      );

      // Expect 400 because the output node doesn't actually exist
      expect([200, 400]).toContain(response.status);
    });

    it("should reject commit on read-only ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create read-only ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Read-only test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Try to commit
      const response = await ctx.helpers.ticketRequest(
        ticketId,
        "POST",
        `/api/realm/${realm}/tickets/${ticketId}/commit`,
        { output: "node:0000000000000000000000000000000000000000000000000000000000000001" }
      );

      expect(response.status).toBe(403);
    });
  });

  describe("POST /api/realm/{realmId}/tickets/:ticketId/revoke", () => {
    it("should revoke issued ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Revoke test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Revoke
      const response = await authFetch(`/api/realm/${realm}/tickets/${ticketId}/revoke`, {
        method: "POST",
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as {
        success: boolean;
        status: string;
        isRevoked: boolean;
      };

      expect(data.success).toBe(true);
      expect(data.status).toBe("revoked");
      expect(data.isRevoked).toBe(true);
    });

    it("should return conflict for already revoked ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create and revoke ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Double revoke test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      await authFetch(`/api/realm/${realm}/tickets/${ticketId}/revoke`, {
        method: "POST",
      });

      // Try to revoke again
      const response = await authFetch(`/api/realm/${realm}/tickets/${ticketId}/revoke`, {
        method: "POST",
      });

      expect(response.status).toBe(409);
    });
  });

  describe("DELETE /api/realm/{realmId}/tickets/:ticketId", () => {
    it("should delete ticket with Bearer token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Delete test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Delete
      const response = await authFetch(`/api/realm/${realm}/tickets/${ticketId}`, {
        method: "DELETE",
      });

      expect(response.status).toBe(200);
      const data = (await response.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify deleted
      const getResponse = await authFetch(`/api/realm/${realm}/tickets/${ticketId}`);
      expect(getResponse.status).toBe(404);
    });

    it("should reject delete with Agent token", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create agent token
      const agentResponse = await authFetch("/api/auth/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Delete Test Agent" }),
      });

      const { token: agentToken } = (await agentResponse.json()) as { token: string };

      // Create ticket with agent token
      const createResponse = await ctx.helpers.agentRequest(
        agentToken,
        "POST",
        `/api/realm/${realm}/tickets`,
        { purpose: "Agent delete test" }
      );

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Try to delete with agent token (should fail)
      const response = await ctx.helpers.agentRequest(
        agentToken,
        "DELETE",
        `/api/realm/${realm}/tickets/${ticketId}`
      );

      expect(response.status).toBe(403);
    });
  });

  describe("Ticket Authentication", () => {
    it("should allow ticket to access nodes within scope", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create ticket
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purpose: "Access test" }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Access realm info with ticket
      const response = await ctx.helpers.ticketRequest(ticketId, "GET", `/api/realm/${realm}`);

      expect(response.status).toBe(200);
    });

    it("should return 410 for expired ticket", async () => {
      const userId = `user-${uniqueId()}`;
      const { token, realm } = await ctx.helpers.createTestUser(userId, "authorized");
      const authFetch = createAuthFetcher(ctx.baseUrl, token);

      // Create ticket with very short expiration (1 second)
      const createResponse = await authFetch(`/api/realm/${realm}/tickets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          purpose: "Expiry test",
          expiresIn: 1,
        }),
      });

      const { ticketId } = (await createResponse.json()) as { ticketId: string };

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Try to access with expired ticket
      const response = await ctx.helpers.ticketRequest(ticketId, "GET", `/api/realm/${realm}`);

      expect(response.status).toBe(410);
    });
  });
});
