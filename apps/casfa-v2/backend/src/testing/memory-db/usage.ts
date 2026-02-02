/**
 * In-memory implementation of UsageDb for testing
 */

import type { RealmUsage } from "../../types.ts"
import type { UsageDb } from "../../db/usage.ts"

// ============================================================================
// Factory
// ============================================================================

export const createMemoryUsageDb = (): UsageDb & { _store: Map<string, RealmUsage>; _clear: () => void } => {
  const store = new Map<string, RealmUsage>()

  const defaultUsage = (realm: string): RealmUsage => ({
    realm,
    physicalBytes: 0,
    logicalBytes: 0,
    nodeCount: 0,
    quotaLimit: 0,
    updatedAt: Date.now(),
  })

  const getUsage = async (realm: string): Promise<RealmUsage> => {
    return store.get(realm) ?? defaultUsage(realm)
  }

  const updateUsage = async (
    realm: string,
    delta: { physicalBytes?: number; logicalBytes?: number; nodeCount?: number }
  ): Promise<void> => {
    const usage = store.get(realm) ?? defaultUsage(realm)

    if (delta.physicalBytes !== undefined) {
      usage.physicalBytes += delta.physicalBytes
    }
    if (delta.logicalBytes !== undefined) {
      usage.logicalBytes += delta.logicalBytes
    }
    if (delta.nodeCount !== undefined) {
      usage.nodeCount += delta.nodeCount
    }

    usage.updatedAt = Date.now()
    store.set(realm, usage)
  }

  const checkQuota = async (
    realm: string,
    additionalBytes: number
  ): Promise<{ allowed: boolean; usage: RealmUsage }> => {
    const usage = await getUsage(realm)

    // If no quota limit set, always allow
    if (usage.quotaLimit === 0) {
      return { allowed: true, usage }
    }

    const allowed = usage.physicalBytes + additionalBytes <= usage.quotaLimit
    return { allowed, usage }
  }

  const setQuotaLimit = async (realm: string, quotaLimit: number): Promise<void> => {
    const usage = store.get(realm) ?? defaultUsage(realm)
    usage.quotaLimit = quotaLimit
    usage.updatedAt = Date.now()
    store.set(realm, usage)
  }

  return {
    getUsage,
    updateUsage,
    checkQuota,
    setQuotaLimit,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
