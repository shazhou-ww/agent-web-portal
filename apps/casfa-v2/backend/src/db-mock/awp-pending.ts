/**
 * In-memory implementation of AwpPendingDb for testing
 */

import type { AwpPendingDb } from "../db/awp-pending.ts";
import type { AwpPendingAuth } from "../types.ts";

// ============================================================================
// Factory
// ============================================================================

export const createMemoryAwpPendingDb = (): AwpPendingDb & {
  _store: Map<string, AwpPendingAuth>;
  _clear: () => void;
} => {
  const store = new Map<string, AwpPendingAuth>();

  const create = async (data: AwpPendingAuth): Promise<void> => {
    store.set(data.pubkey, data);
  };

  const get = async (pubkey: string): Promise<AwpPendingAuth | null> => {
    const pending = store.get(pubkey);
    if (!pending) return null;

    // Check if expired
    if (pending.expiresAt < Date.now()) {
      store.delete(pubkey);
      return null;
    }

    return pending;
  };

  const deleteEntry = async (pubkey: string): Promise<void> => {
    store.delete(pubkey);
  };

  const validateCode = async (pubkey: string, code: string): Promise<boolean> => {
    const pending = await get(pubkey);
    if (!pending) return false;
    return pending.verificationCode === code;
  };

  return {
    create,
    get,
    delete: deleteEntry,
    validateCode,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  };
};
