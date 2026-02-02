/**
 * In-memory implementation of RefCountDb for testing
 */

import type { RefCount, GcStatus } from "../../types.ts"
import type { RefCountDb } from "../../db/refcount.ts"

// ============================================================================
// Types
// ============================================================================

type RefCountRecord = RefCount & {
  pendingSince?: number
}

// ============================================================================
// Factory
// ============================================================================

export const createMemoryRefCountDb = (): RefCountDb & { _store: Map<string, RefCountRecord>; _clear: () => void } => {
  const store = new Map<string, RefCountRecord>()

  const makeKey = (realm: string, key: string) => `${realm}#${key}`

  const getRefCount = async (realm: string, key: string): Promise<RefCount | null> => {
    const record = store.get(makeKey(realm, key))
    if (!record) return null

    return {
      realm: record.realm,
      key: record.key,
      count: record.count,
      physicalSize: record.physicalSize,
      logicalSize: record.logicalSize,
      gcStatus: record.gcStatus,
      createdAt: record.createdAt,
    }
  }

  const incrementRef = async (
    realm: string,
    key: string,
    physicalSize: number,
    logicalSize: number
  ): Promise<{ isNewToRealm: boolean }> => {
    const storeKey = makeKey(realm, key)
    const existing = store.get(storeKey)

    if (existing) {
      // Increment existing
      existing.count += 1
      existing.gcStatus = "active"
      delete existing.pendingSince
      return { isNewToRealm: false }
    }

    // Create new
    const record: RefCountRecord = {
      realm,
      key,
      count: 1,
      physicalSize,
      logicalSize,
      gcStatus: "active" as GcStatus,
      createdAt: Date.now(),
    }

    store.set(storeKey, record)
    return { isNewToRealm: true }
  }

  const decrementRef = async (
    realm: string,
    key: string
  ): Promise<{ newCount: number; deleted: boolean }> => {
    const storeKey = makeKey(realm, key)
    const record = store.get(storeKey)

    if (!record || record.count <= 0) {
      return { newCount: 0, deleted: true }
    }

    record.count -= 1

    if (record.count === 0) {
      record.gcStatus = "pending"
      record.pendingSince = Date.now()
    }

    return { newCount: record.count, deleted: record.count === 0 }
  }

  return {
    getRefCount,
    incrementRef,
    decrementRef,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
