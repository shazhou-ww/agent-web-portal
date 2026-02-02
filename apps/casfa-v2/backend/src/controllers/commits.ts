/**
 * Commits controller
 */

import type { Context } from "hono"
import type { CommitsDb } from "../db/commits.ts"
import type { OwnershipDb } from "../db/ownership.ts"
import type { RefCountDb } from "../db/refcount.ts"
import type { TokensDb } from "../db/tokens.ts"
import type { StorageProvider } from "@agent-web-portal/cas-storage-core"
import type { Env, Ticket } from "../types.ts"
import { extractTokenId } from "../util/token-id.ts"

export type CommitsController = {
  create: (c: Context<Env>) => Promise<Response>
  list: (c: Context<Env>) => Promise<Response>
  get: (c: Context<Env>) => Promise<Response>
  update: (c: Context<Env>) => Promise<Response>
  delete: (c: Context<Env>) => Promise<Response>
}

type CommitsControllerDeps = {
  commitsDb: CommitsDb
  ownershipDb: OwnershipDb
  refCountDb: RefCountDb
  tokensDb: TokensDb
  storage: StorageProvider
}

export const createCommitsController = (deps: CommitsControllerDeps): CommitsController => {
  const { commitsDb, ownershipDb, refCountDb, tokensDb, storage } = deps

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm
  }

  return {
    create: async (c) => {
      const auth = c.get("auth")
      const realm = getRealm(c)
      const body = await c.req.json()
      const { root, title } = body

      // Verify root exists
      const rootExists = await storage.has(root)
      if (!rootExists) {
        return c.json({
          success: false,
          error: "root_not_found",
          message: `Root node ${root} not found. Upload it via PUT /chunks/${root} first.`,
        })
      }

      // Verify ownership
      const hasOwnership = await ownershipDb.hasOwnership(realm, root)
      if (!hasOwnership) {
        return c.json({ error: "Root node not owned by this realm" }, 403)
      }

      // Increment reference count for root
      const rootRef = await refCountDb.getRefCount(realm, root)
      if (rootRef) {
        await refCountDb.incrementRef(realm, root, rootRef.physicalSize, rootRef.logicalSize)
      }

      // Record commit
      const tokenId = extractTokenId(auth.token.pk)
      await commitsDb.create(realm, root, tokenId, title)

      // Mark ticket as committed if applicable
      if (auth.token.type === "ticket") {
        const ticketId = extractTokenId(auth.token.pk)
        const marked = await tokensDb.markTicketCommitted(ticketId, root)
        if (!marked) {
          return c.json({ error: "Ticket already committed" }, 403)
        }
      }

      return c.json({ success: true, root })
    },

    list: async (c) => {
      const realm = getRealm(c)
      const limit = Math.min(Number.parseInt(c.req.query("limit") ?? "100", 10), 1000)
      const startKey = c.req.query("startKey")

      const result = await commitsDb.list(realm, { limit, startKey })

      return c.json({
        commits: result.commits.map((commit) => ({
          root: commit.root,
          title: commit.title,
          createdAt: new Date(commit.createdAt).toISOString(),
        })),
        nextKey: result.nextKey,
      })
    },

    get: async (c) => {
      const realm = getRealm(c)
      const root = decodeURIComponent(c.req.param("root"))

      const commit = await commitsDb.get(realm, root)
      if (!commit) {
        return c.json({ error: "Commit not found" }, 404)
      }

      return c.json({
        root: commit.root,
        title: commit.title,
        createdAt: new Date(commit.createdAt).toISOString(),
        createdBy: commit.createdBy,
      })
    },

    update: async (c) => {
      const realm = getRealm(c)
      const root = decodeURIComponent(c.req.param("root"))
      const body = await c.req.json()

      const commit = await commitsDb.update(realm, root, { title: body.title })
      if (!commit) {
        return c.json({ error: "Commit not found" }, 404)
      }

      return c.json({
        root: commit.root,
        title: commit.title,
        createdAt: new Date(commit.createdAt).toISOString(),
      })
    },

    delete: async (c) => {
      const realm = getRealm(c)
      const root = decodeURIComponent(c.req.param("root"))

      // Verify commit exists
      const commit = await commitsDb.get(realm, root)
      if (!commit) {
        return c.json({ error: "Commit not found" }, 404)
      }

      // Decrement reference count
      await refCountDb.decrementRef(realm, root)

      // Delete commit
      const deleted = await commitsDb.delete(realm, root)
      if (!deleted) {
        return c.json({ error: "Commit not found" }, 404)
      }

      return c.json({ success: true })
    },
  }
}
