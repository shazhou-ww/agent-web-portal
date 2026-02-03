/**
 * In-memory implementation of OwnershipDb for testing
 */

import type { OwnershipDb } from "../db/ownership.ts";
import type { CasOwnership, NodeKind } from "../types.ts";

// ============================================================================
// Factory
// ============================================================================

export const createMemoryOwnershipDb = (): OwnershipDb & {
  _store: Map<string, CasOwnership>;
  _clear: () => void;
} => {
  const store = new Map<string, CasOwnership>();

  const makeKey = (realm: string, key: string) => `${realm}#${key}`;

  const hasOwnership = async (realm: string, key: string): Promise<boolean> => {
    return store.has(makeKey(realm, key));
  };

  const getOwnership = async (realm: string, key: string): Promise<CasOwnership | null> => {
    return store.get(makeKey(realm, key)) ?? null;
  };

  const addOwnership = async (
    realm: string,
    key: string,
    createdBy: string,
    contentType: string,
    size: number,
    kind?: NodeKind
  ): Promise<void> => {
    const ownership: CasOwnership = {
      realm,
      key,
      kind,
      createdAt: Date.now(),
      createdBy,
      contentType,
      size,
    };

    store.set(makeKey(realm, key), ownership);
  };

  const listByRealm = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ items: CasOwnership[]; nextKey?: string }> => {
    const limit = options.limit ?? 100;
    const items: CasOwnership[] = [];

    for (const ownership of store.values()) {
      if (ownership.realm === realm) {
        items.push(ownership);
      }
    }

    // Sort by key for consistent ordering
    items.sort((a, b) => a.key.localeCompare(b.key));

    // Handle pagination
    let startIndex = 0;
    if (options.startKey) {
      const startIdx = items.findIndex((o) => o.key === options.startKey);
      if (startIdx >= 0) startIndex = startIdx + 1;
    }

    const pagedItems = items.slice(startIndex, startIndex + limit);
    const nextKey = startIndex + limit < items.length ? items[startIndex + limit]?.key : undefined;

    return { items: pagedItems, nextKey };
  };

  const deleteOwnership = async (realm: string, key: string): Promise<void> => {
    store.delete(makeKey(realm, key));
  };

  return {
    hasOwnership,
    getOwnership,
    addOwnership,
    listByRealm,
    deleteOwnership,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  };
};
