/**
 * Tests for the test app factory
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { createTestApp, startTestServer } from "../test-app.ts"

describe("TestApp", () => {
  describe("createTestApp", () => {
    it("should create a test app with all dependencies", () => {
      const testApp = createTestApp()

      expect(testApp.app).toBeDefined()
      expect(testApp.db).toBeDefined()
      expect(testApp.storage).toBeDefined()
      expect(testApp.config).toBeDefined()
      expect(testApp.helpers).toBeDefined()
      expect(testApp.reset).toBeInstanceOf(Function)
    })

    it("should support custom config", () => {
      const testApp = createTestApp({
        config: {
          server: {
            nodeLimit: 1000,
            maxNameBytes: 255,
            maxCollectionChildren: 10000,
            maxPayloadSize: 1024,
            maxTicketTtl: 86400,
            maxAgentTokenTtl: 2592000,
            baseUrl: "http://localhost:3560",
          },
        },
      })

      expect(testApp.config.server.maxPayloadSize).toBe(1024)
    })

    it("should create test users", async () => {
      const testApp = createTestApp()

      const { userId, token, realm } = await testApp.helpers.createTestUser("test-user-1")

      expect(userId).toBe("test-user-1")
      expect(token).toBeDefined()
      // realm format matches auth middleware: usr_{userId}
      expect(realm).toBe("usr_test-user-1")

      // Verify user role was set
      const role = await testApp.db.userRolesDb.getRole("test-user-1")
      expect(role).toBe("authorized")
    })

    it("should create admin users", async () => {
      const testApp = createTestApp()

      const { userId } = await testApp.helpers.createTestUser("admin-user", "admin")

      const role = await testApp.db.userRolesDb.getRole("admin-user")
      expect(role).toBe("admin")
    })

    it("should create test tickets", async () => {
      const testApp = createTestApp()

      const { userId, realm } = await testApp.helpers.createTestUser("test-user")
      const { ticketId, ticket } = await testApp.helpers.createTestTicket(realm, userId)

      expect(ticketId).toBeDefined()
      expect(ticket.realm).toBe(realm)
      expect(ticket.issuerId).toBe(userId)
    })

    it("should reset all databases", async () => {
      const testApp = createTestApp()

      // Create some data
      await testApp.helpers.createTestUser("user-1")
      await testApp.db.commitsDb.create("realm-1", "root-1", "user-1")

      // Verify data exists
      let commit = await testApp.db.commitsDb.get("realm-1", "root-1")
      expect(commit).toBeDefined()

      // Reset
      testApp.reset()

      // Verify data is gone
      commit = await testApp.db.commitsDb.get("realm-1", "root-1")
      expect(commit).toBeNull()
    })
  })

  describe("HTTP Requests", () => {
    it("should handle health check", async () => {
      const testApp = createTestApp()

      const response = await testApp.app.fetch(
        new Request("http://localhost/api/health")
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { status: string }
      expect(data.status).toBe("ok")
    })

    it("should require authentication for protected routes", async () => {
      const testApp = createTestApp()

      const response = await testApp.app.fetch(
        new Request("http://localhost/api/realm/usr:test/usage")
      )

      expect(response.status).toBe(401)
    })

    it("should handle authenticated requests", async () => {
      const testApp = createTestApp()

      const { token, realm } = await testApp.helpers.createTestUser("test-user")

      const response = await testApp.helpers.authRequest(
        token,
        "GET",
        `/api/realm/${realm}/usage`
      )

      expect(response.status).toBe(200)
      const data = (await response.json()) as { realm: string }
      expect(data.realm).toBe(realm)
    })
  })

  describe("startTestServer", () => {
    it("should start a test server", async () => {
      const server = startTestServer()

      try {
        expect(server.url).toMatch(/^http:\/\/localhost:\d+$/)

        // Make a request to the server
        const response = await fetch(`${server.url}/api/health`)
        expect(response.status).toBe(200)
      } finally {
        server.stop()
      }
    })

    it("should start on specified port", async () => {
      const port = 13560 + Math.floor(Math.random() * 1000)
      const server = startTestServer({ port })

      try {
        expect(server.url).toBe(`http://localhost:${port}`)
      } finally {
        server.stop()
      }
    })
  })
})
