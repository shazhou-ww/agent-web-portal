/**
 * In-memory implementation of DepotsDb for testing
 */

import type { Depot, DepotHistory } from "../types.ts"
import type { DepotsDb } from "../db/depots.ts"
import { generateDepotId } from "../util/token-id.ts"

// ============================================================================
// Factory
// ============================================================================

type StoreData = {
  depots: Map<string, Depot>
  history: Map<string, DepotHistory>
}

export const createMemoryDepotsDb = (): DepotsDb & { _store: StoreData; _clear: () => void } => {
  const store: StoreData = {
    depots: new Map(),
    history: new Map(),
  }

  const makeDepotKey = (realm: string, depotId: string) => `${realm}#${depotId}`
  const makeHistoryKey = (realm: string, depotId: string, version: number) =>
    `${realm}#${depotId}#${String(version).padStart(10, "0")}`

  const create = async (
    realm: string,
    options: { name: string; root: string; description?: string }
  ): Promise<Depot> => {
    const depotId = generateDepotId()
    const now = Date.now()

    const depot: Depot = {
      realm,
      depotId,
      name: options.name,
      root: options.root,
      version: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description,
    }

    store.depots.set(makeDepotKey(realm, depotId), depot)

    // Create initial history record
    const historyRecord: DepotHistory = {
      realm,
      depotId,
      version: 1,
      root: options.root,
      createdAt: now,
      message: "Initial version",
    }

    store.history.set(makeHistoryKey(realm, depotId, 1), historyRecord)

    return depot
  }

  const get = async (realm: string, depotId: string): Promise<Depot | null> => {
    return store.depots.get(makeDepotKey(realm, depotId)) ?? null
  }

  const getByName = async (realm: string, name: string): Promise<Depot | null> => {
    for (const depot of store.depots.values()) {
      if (depot.realm === realm && depot.name === name) {
        return depot
      }
    }
    return null
  }

  const updateRoot = async (
    realm: string,
    depotId: string,
    root: string,
    message?: string
  ): Promise<{ depot: Depot; history: DepotHistory }> => {
    const depotKey = makeDepotKey(realm, depotId)
    const depot = store.depots.get(depotKey)

    if (!depot) {
      throw new Error("Depot not found")
    }

    const now = Date.now()
    const newVersion = depot.version + 1

    // Update depot
    const updatedDepot: Depot = {
      ...depot,
      root,
      version: newVersion,
      updatedAt: now,
    }

    store.depots.set(depotKey, updatedDepot)

    // Create history record
    const historyRecord: DepotHistory = {
      realm,
      depotId,
      version: newVersion,
      root,
      createdAt: now,
      message,
    }

    store.history.set(makeHistoryKey(realm, depotId, newVersion), historyRecord)

    return { depot: updatedDepot, history: historyRecord }
  }

  const deleteDepot = async (realm: string, depotId: string): Promise<boolean> => {
    const key = makeDepotKey(realm, depotId)
    if (!store.depots.has(key)) return false
    store.depots.delete(key)
    return true
  }

  const list = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ depots: Depot[]; nextKey?: string }> => {
    const limit = options.limit ?? 100
    const depots: Depot[] = []

    for (const depot of store.depots.values()) {
      if (depot.realm === realm) {
        depots.push(depot)
      }
    }

    // Sort by depotId for consistent ordering
    depots.sort((a, b) => a.depotId.localeCompare(b.depotId))

    // Handle pagination
    let startIndex = 0
    if (options.startKey) {
      const startIdx = depots.findIndex((d) => d.depotId === options.startKey)
      if (startIdx >= 0) startIndex = startIdx + 1
    }

    const pagedDepots = depots.slice(startIndex, startIndex + limit)
    const nextKey = startIndex + limit < depots.length ? depots[startIndex + limit]?.depotId : undefined

    return { depots: pagedDepots, nextKey }
  }

  const getHistory = async (
    realm: string,
    depotId: string,
    version: number
  ): Promise<DepotHistory | null> => {
    return store.history.get(makeHistoryKey(realm, depotId, version)) ?? null
  }

  const listHistory = async (
    realm: string,
    depotId: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ history: DepotHistory[]; nextKey?: string }> => {
    const limit = options.limit ?? 50
    const history: DepotHistory[] = []

    for (const record of store.history.values()) {
      if (record.realm === realm && record.depotId === depotId) {
        history.push(record)
      }
    }

    // Sort by version descending (newest first)
    history.sort((a, b) => b.version - a.version)

    // Handle pagination
    let startIndex = 0
    if (options.startKey) {
      // startKey is the full sk like "DEPOT_HIST#depotId#0000000002"
      const versionMatch = options.startKey.match(/(\d+)$/)
      if (versionMatch && versionMatch[1]) {
        const version = Number.parseInt(versionMatch[1], 10)
        const startIdx = history.findIndex((h) => h.version === version)
        if (startIdx >= 0) startIndex = startIdx + 1
      }
    }

    const pagedHistory = history.slice(startIndex, startIndex + limit)
    const nextKey = startIndex + limit < history.length
      ? makeHistoryKey(realm, depotId, history[startIndex + limit]!.version)
      : undefined

    return { history: pagedHistory, nextKey }
  }

  return {
    create,
    get,
    getByName,
    updateRoot,
    delete: deleteDepot,
    list,
    getHistory,
    listHistory,
    // Testing utilities
    _store: store,
    _clear: () => {
      store.depots.clear()
      store.history.clear()
    },
  }
}
