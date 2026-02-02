/**
 * In-memory implementation of AwpPubkeysDb for testing
 */

import type { AwpPubkey } from "../types.ts"
import type { AwpPubkeysDb } from "../db/awp-pubkeys.ts"

// ============================================================================
// Factory
// ============================================================================

export const createMemoryAwpPubkeysDb = (): AwpPubkeysDb & { _store: Map<string, AwpPubkey>; _clear: () => void } => {
  const store = new Map<string, AwpPubkey>()

  const store_ = async (data: AwpPubkey): Promise<void> => {
    store.set(data.pubkey, data)
  }

  const lookup = async (pubkey: string): Promise<AwpPubkey | null> => {
    const record = store.get(pubkey)
    if (!record) return null

    // Check if expired
    if (record.expiresAt && record.expiresAt < Date.now()) {
      store.delete(pubkey)
      return null
    }

    return record
  }

  const listByUser = async (userId: string): Promise<AwpPubkey[]> => {
    const now = Date.now()
    const pubkeys: AwpPubkey[] = []

    for (const record of store.values()) {
      if (record.userId === userId && (!record.expiresAt || record.expiresAt > now)) {
        pubkeys.push(record)
      }
    }

    return pubkeys
  }

  const revoke = async (pubkey: string): Promise<void> => {
    store.delete(pubkey)
  }

  return {
    store: store_,
    lookup,
    listByUser,
    revoke,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
