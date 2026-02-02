/**
 * Depots controller
 */

import type { Context } from "hono"
import { decodeNode, EMPTY_DICT_KEY, EMPTY_DICT_BYTES } from "@agent-web-portal/cas-core"
import type { StorageProvider } from "@agent-web-portal/cas-storage-core"
import type { DepotsDb, MAIN_DEPOT_NAME } from "../db/depots.ts"
import type { RefCountDb } from "../db/refcount.ts"
import type { Env } from "../types.ts"

export type DepotsController = {
  list: (c: Context<Env>) => Promise<Response>
  create: (c: Context<Env>) => Promise<Response>
  get: (c: Context<Env>) => Promise<Response>
  update: (c: Context<Env>) => Promise<Response>
  delete: (c: Context<Env>) => Promise<Response>
  history: (c: Context<Env>) => Promise<Response>
  rollback: (c: Context<Env>) => Promise<Response>
}

type DepotsControllerDeps = {
  depotsDb: DepotsDb
  refCountDb: RefCountDb
  storage: StorageProvider
}

export const createDepotsController = (deps: DepotsControllerDeps): DepotsController => {
  const { depotsDb, refCountDb, storage } = deps

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm
  }

  const ensureEmptyDict = async (): Promise<void> => {
    const exists = await storage.has(EMPTY_DICT_KEY)
    if (!exists) {
      await storage.put(EMPTY_DICT_KEY, EMPTY_DICT_BYTES)
    }
  }

  return {
    list: async (c) => {
      const realm = getRealm(c)
      const limit = Number.parseInt(c.req.query("limit") ?? "100", 10)
      const cursor = c.req.query("cursor")

      const result = await depotsDb.list(realm, { limit, startKey: cursor })

      return c.json({
        depots: result.depots.map((d) => ({
          depotId: d.depotId,
          name: d.name,
          root: d.root,
          version: d.version,
          createdAt: new Date(d.createdAt).toISOString(),
          updatedAt: new Date(d.updatedAt).toISOString(),
          description: d.description,
        })),
        cursor: result.nextKey,
      })
    },

    create: async (c) => {
      const realm = getRealm(c)
      const body = await c.req.json()
      const { name, description } = body

      // Check if exists
      const existing = await depotsDb.getByName(realm, name)
      if (existing) {
        return c.json({ error: `Depot with name '${name}' already exists` }, 409)
      }

      // Ensure empty dict exists
      await ensureEmptyDict()

      // Increment ref for empty dict
      await refCountDb.incrementRef(realm, EMPTY_DICT_KEY, EMPTY_DICT_BYTES.length, 0)

      // Create depot
      const depot = await depotsDb.create(realm, {
        name,
        root: EMPTY_DICT_KEY,
        description,
      })

      return c.json(
        {
          depotId: depot.depotId,
          name: depot.name,
          root: depot.root,
          version: depot.version,
          createdAt: new Date(depot.createdAt).toISOString(),
          updatedAt: new Date(depot.updatedAt).toISOString(),
          description: depot.description,
        },
        201
      )
    },

    get: async (c) => {
      const realm = getRealm(c)
      const depotId = decodeURIComponent(c.req.param("depotId"))

      const depot = await depotsDb.get(realm, depotId)
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404)
      }

      return c.json({
        depotId: depot.depotId,
        name: depot.name,
        root: depot.root,
        version: depot.version,
        createdAt: new Date(depot.createdAt).toISOString(),
        updatedAt: new Date(depot.updatedAt).toISOString(),
        description: depot.description,
      })
    },

    update: async (c) => {
      const realm = getRealm(c)
      const depotId = decodeURIComponent(c.req.param("depotId"))
      const body = await c.req.json()
      const { root: newRoot, message } = body

      // Get current depot
      const depot = await depotsDb.get(realm, depotId)
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404)
      }

      const oldRoot = depot.root

      // Verify new root exists
      const exists = await storage.has(newRoot)
      if (!exists) {
        return c.json({ error: "New root node does not exist" }, 400)
      }

      // Get new root info
      const newRootBytes = await storage.get(newRoot)
      if (!newRootBytes) {
        return c.json({ error: "Failed to read new root node" }, 400)
      }

      const decoded = decodeNode(newRootBytes)
      const physicalSize = newRootBytes.length
      const logicalSize = decoded.kind !== "dict" ? decoded.size : 0

      // Update refs
      await refCountDb.incrementRef(realm, newRoot, physicalSize, logicalSize)
      await refCountDb.decrementRef(realm, oldRoot)

      // Update depot
      const { depot: updatedDepot } = await depotsDb.updateRoot(realm, depotId, newRoot, message)

      return c.json({
        depotId: updatedDepot.depotId,
        name: updatedDepot.name,
        root: updatedDepot.root,
        version: updatedDepot.version,
        createdAt: new Date(updatedDepot.createdAt).toISOString(),
        updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
        description: updatedDepot.description,
      })
    },

    delete: async (c) => {
      const realm = getRealm(c)
      const depotId = decodeURIComponent(c.req.param("depotId"))

      const depot = await depotsDb.get(realm, depotId)
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404)
      }

      if (depot.name === "main") {
        return c.json({ error: "Cannot delete the main depot" }, 403)
      }

      // Decrement ref for current root
      await refCountDb.decrementRef(realm, depot.root)

      // Delete depot
      await depotsDb.delete(realm, depotId)

      return c.json({ deleted: true })
    },

    history: async (c) => {
      const realm = getRealm(c)
      const depotId = decodeURIComponent(c.req.param("depotId"))
      const limit = Number.parseInt(c.req.query("limit") ?? "50", 10)
      const cursor = c.req.query("cursor")

      // Verify depot exists
      const depot = await depotsDb.get(realm, depotId)
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404)
      }

      const result = await depotsDb.listHistory(realm, depotId, { limit, startKey: cursor })

      return c.json({
        history: result.history.map((h) => ({
          version: h.version,
          root: h.root,
          createdAt: new Date(h.createdAt).toISOString(),
          message: h.message,
        })),
        cursor: result.nextKey,
      })
    },

    rollback: async (c) => {
      const realm = getRealm(c)
      const depotId = decodeURIComponent(c.req.param("depotId"))
      const body = await c.req.json()
      const { version } = body

      // Get current depot
      const depot = await depotsDb.get(realm, depotId)
      if (!depot) {
        return c.json({ error: "Depot not found" }, 404)
      }

      // Get history record
      const historyRecord = await depotsDb.getHistory(realm, depotId, version)
      if (!historyRecord) {
        return c.json({ error: `Version ${version} not found` }, 404)
      }

      const oldRoot = depot.root
      const newRoot = historyRecord.root

      // Skip if same
      if (oldRoot === newRoot) {
        return c.json({
          depotId: depot.depotId,
          name: depot.name,
          root: depot.root,
          version: depot.version,
          createdAt: new Date(depot.createdAt).toISOString(),
          updatedAt: new Date(depot.updatedAt).toISOString(),
          description: depot.description,
          message: "Already at this version",
        })
      }

      // Get target root info
      const newRootBytes = await storage.get(newRoot)
      if (!newRootBytes) {
        return c.json({ error: "Failed to read target root node" }, 500)
      }

      const decoded = decodeNode(newRootBytes)
      const physicalSize = newRootBytes.length
      const logicalSize = decoded.kind !== "dict" ? decoded.size : 0

      // Update refs
      await refCountDb.incrementRef(realm, newRoot, physicalSize, logicalSize)
      await refCountDb.decrementRef(realm, oldRoot)

      // Update depot
      const { depot: updatedDepot } = await depotsDb.updateRoot(
        realm,
        depotId,
        newRoot,
        `Rollback to version ${version}`
      )

      return c.json({
        depotId: updatedDepot.depotId,
        name: updatedDepot.name,
        root: updatedDepot.root,
        version: updatedDepot.version,
        createdAt: new Date(updatedDepot.createdAt).toISOString(),
        updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
        description: updatedDepot.description,
      })
    },
  }
}
