/**
 * Tests for in-memory database implementations
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { createAllMemoryDbs } from "../memory-db/index.ts"
import { extractTokenId } from "../../util/token-id.ts"

describe("Memory DB", () => {
  describe("TokensDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should create and retrieve user token", async () => {
      const userToken = await db.tokensDb.createUserToken("user-123", "refresh-token")

      expect(userToken).toBeDefined()
      expect(userToken.type).toBe("user")
      expect(userToken.userId).toBe("user-123")

      // Extract token ID from pk
      const tokenId = extractTokenId(userToken.pk)
      const retrieved = await db.tokensDb.getToken(tokenId)

      expect(retrieved).toBeDefined()
      expect(retrieved?.userId).toBe("user-123")
    })

    it("should create and retrieve agent token", async () => {
      const agentToken = await db.tokensDb.createAgentToken("user-123", "my-agent", {
        description: "Test agent",
      })

      expect(agentToken).toBeDefined()
      expect(agentToken.type).toBe("agent")
      expect(agentToken.name).toBe("my-agent")

      const tokens = await db.tokensDb.listAgentTokensByUser("user-123")
      expect(tokens.length).toBe(1)
      expect(tokens[0]!.name).toBe("my-agent")
    })

    it("should create and retrieve ticket", async () => {
      const ticket = await db.tokensDb.createTicket("realm-1", "issuer-1", {
        scope: ["read", "write"],
      })

      expect(ticket).toBeDefined()
      expect(ticket.type).toBe("ticket")
      expect(ticket.realm).toBe("realm-1")

      const ticketId = extractTokenId(ticket.pk)
      const retrieved = await db.tokensDb.getTicket(ticketId)

      expect(retrieved).toBeDefined()
      expect(retrieved?.scope).toEqual(["read", "write"])
    })

    it("should mark ticket as committed", async () => {
      const ticket = await db.tokensDb.createTicket("realm-1", "issuer-1", {
        commit: { quota: 1 },
      })

      const ticketId = extractTokenId(ticket.pk)

      const result1 = await db.tokensDb.markTicketCommitted(ticketId, "root-hash-1")
      expect(result1).toBe(true)

      // Second commit should fail
      const result2 = await db.tokensDb.markTicketCommitted(ticketId, "root-hash-2")
      expect(result2).toBe(false)

      const updated = await db.tokensDb.getTicket(ticketId)
      expect(updated?.commit?.root).toBe("root-hash-1")
    })
  })

  describe("CommitsDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should create and retrieve commit", async () => {
      const commit = await db.commitsDb.create("realm-1", "root-hash", "user-1", "My commit")

      expect(commit).toBeDefined()
      expect(commit.realm).toBe("realm-1")
      expect(commit.root).toBe("root-hash")
      expect(commit.title).toBe("My commit")

      const retrieved = await db.commitsDb.get("realm-1", "root-hash")
      expect(retrieved).toBeDefined()
      expect(retrieved?.title).toBe("My commit")
    })

    it("should list commits for realm", async () => {
      await db.commitsDb.create("realm-1", "root-1", "user-1", "Commit 1")
      await db.commitsDb.create("realm-1", "root-2", "user-1", "Commit 2")
      await db.commitsDb.create("realm-2", "root-3", "user-1", "Commit 3")

      const { commits } = await db.commitsDb.list("realm-1")
      expect(commits.length).toBe(2)
    })

    it("should delete commit", async () => {
      await db.commitsDb.create("realm-1", "root-1", "user-1")

      const deleted = await db.commitsDb.delete("realm-1", "root-1")
      expect(deleted).toBe(true)

      const retrieved = await db.commitsDb.get("realm-1", "root-1")
      expect(retrieved).toBeNull()
    })
  })

  describe("OwnershipDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should add and check ownership", async () => {
      await db.ownershipDb.addOwnership("realm-1", "hash-abc", "user-1", "application/json", 1024)

      const hasOwnership = await db.ownershipDb.hasOwnership("realm-1", "hash-abc")
      expect(hasOwnership).toBe(true)

      const ownership = await db.ownershipDb.getOwnership("realm-1", "hash-abc")
      expect(ownership).toBeDefined()
      expect(ownership?.size).toBe(1024)
    })

    it("should list ownership by realm", async () => {
      await db.ownershipDb.addOwnership("realm-1", "hash-1", "user-1", "text/plain", 100)
      await db.ownershipDb.addOwnership("realm-1", "hash-2", "user-1", "text/plain", 200)
      await db.ownershipDb.addOwnership("realm-2", "hash-3", "user-1", "text/plain", 300)

      const { items } = await db.ownershipDb.listByRealm("realm-1")
      expect(items.length).toBe(2)
    })
  })

  describe("RefCountDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should increment and track ref count", async () => {
      const result1 = await db.refCountDb.incrementRef("realm-1", "hash-1", 1024, 512)
      expect(result1.isNewToRealm).toBe(true)

      const result2 = await db.refCountDb.incrementRef("realm-1", "hash-1", 1024, 512)
      expect(result2.isNewToRealm).toBe(false)

      const refCount = await db.refCountDb.getRefCount("realm-1", "hash-1")
      expect(refCount?.count).toBe(2)
    })

    it("should decrement ref count", async () => {
      await db.refCountDb.incrementRef("realm-1", "hash-1", 1024, 512)
      await db.refCountDb.incrementRef("realm-1", "hash-1", 1024, 512)

      const result1 = await db.refCountDb.decrementRef("realm-1", "hash-1")
      expect(result1.newCount).toBe(1)
      expect(result1.deleted).toBe(false)

      const result2 = await db.refCountDb.decrementRef("realm-1", "hash-1")
      expect(result2.newCount).toBe(0)
      expect(result2.deleted).toBe(true)
    })
  })

  describe("UsageDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should track usage", async () => {
      await db.usageDb.updateUsage("realm-1", { physicalBytes: 1000, nodeCount: 10 })
      await db.usageDb.updateUsage("realm-1", { physicalBytes: 500, nodeCount: 5 })

      const usage = await db.usageDb.getUsage("realm-1")
      expect(usage.physicalBytes).toBe(1500)
      expect(usage.nodeCount).toBe(15)
    })

    it("should check quota", async () => {
      await db.usageDb.setQuotaLimit("realm-1", 1000)
      await db.usageDb.updateUsage("realm-1", { physicalBytes: 800 })

      const result1 = await db.usageDb.checkQuota("realm-1", 100)
      expect(result1.allowed).toBe(true)

      const result2 = await db.usageDb.checkQuota("realm-1", 300)
      expect(result2.allowed).toBe(false)
    })
  })

  describe("UserRolesDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should manage user roles", async () => {
      const defaultRole = await db.userRolesDb.getRole("user-1")
      expect(defaultRole).toBe("unauthorized")

      await db.userRolesDb.setRole("user-1", "user")
      const userRole = await db.userRolesDb.getRole("user-1")
      expect(userRole).toBe("user")

      await db.userRolesDb.setRole("user-1", "admin")
      const adminRole = await db.userRolesDb.getRole("user-1")
      expect(adminRole).toBe("admin")
    })

    it("should list all roles", async () => {
      await db.userRolesDb.setRole("user-1", "user")
      await db.userRolesDb.setRole("user-2", "admin")

      const roles = await db.userRolesDb.listRoles()
      expect(roles.length).toBe(2)
    })
  })

  describe("DepotsDb", () => {
    const db = createAllMemoryDbs()

    beforeEach(() => {
      db.clearAll()
    })

    it("should create and retrieve depot", async () => {
      const depot = await db.depotsDb.create("realm-1", {
        name: "main",
        root: "root-hash",
        description: "Main depot",
      })

      expect(depot).toBeDefined()
      expect(depot.name).toBe("main")
      expect(depot.version).toBe(1)

      const retrieved = await db.depotsDb.get("realm-1", depot.depotId)
      expect(retrieved).toBeDefined()
      expect(retrieved?.name).toBe("main")

      const byName = await db.depotsDb.getByName("realm-1", "main")
      expect(byName).toBeDefined()
      expect(byName?.depotId).toBe(depot.depotId)
    })

    it("should update depot root and create history", async () => {
      const depot = await db.depotsDb.create("realm-1", {
        name: "main",
        root: "root-1",
      })

      const { depot: updated, history } = await db.depotsDb.updateRoot(
        "realm-1",
        depot.depotId,
        "root-2",
        "Update message"
      )

      expect(updated.version).toBe(2)
      expect(updated.root).toBe("root-2")
      expect(history.message).toBe("Update message")

      const { history: historyList } = await db.depotsDb.listHistory("realm-1", depot.depotId)
      expect(historyList.length).toBe(2)
    })
  })
})
