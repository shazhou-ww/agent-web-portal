/**
 * Memory Ownership Storage
 *
 * In-memory implementation of OwnershipDb for local development.
 */

import type { CasOwnership, IOwnershipDb } from "./types.ts";

export class MemoryOwnershipDb implements IOwnershipDb {
  private ownership = new Map<string, CasOwnership>();

  private key(realm: string, casKey: string): string {
    return `${realm}#${casKey}`;
  }

  async hasOwnership(realm: string, casKey: string): Promise<boolean> {
    return this.ownership.has(this.key(realm, casKey));
  }

  async getOwnership(realm: string, casKey: string): Promise<CasOwnership | null> {
    return this.ownership.get(this.key(realm, casKey)) ?? null;
  }

  async checkOwnership(
    realm: string,
    keys: string[]
  ): Promise<{ found: string[]; missing: string[] }> {
    const found: string[] = [];
    const missing: string[] = [];
    for (const k of keys) {
      if (this.ownership.has(this.key(realm, k))) {
        found.push(k);
      } else {
        missing.push(k);
      }
    }
    return { found, missing };
  }

  async addOwnership(
    realm: string,
    casKey: string,
    createdBy: string,
    contentType: string,
    size: number
  ): Promise<CasOwnership> {
    const record: CasOwnership = {
      realm,
      key: casKey,
      createdAt: Date.now(),
      createdBy,
      contentType,
      size,
    };
    this.ownership.set(this.key(realm, casKey), record);
    return record;
  }

  async listNodes(
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ nodes: CasOwnership[]; nextKey?: string; total: number }> {
    const { limit = 10, startKey } = options;
    // Get all nodes for this realm
    const allNodes: CasOwnership[] = [];
    for (const record of this.ownership.values()) {
      if (record.realm === realm) {
        allNodes.push(record);
      }
    }

    // Sort by createdAt descending (newest first)
    allNodes.sort((a, b) => b.createdAt - a.createdAt);

    // Find start position
    let startIndex = 0;
    if (startKey) {
      const idx = allNodes.findIndex((n) => n.key === startKey);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    // Paginate
    const nodes = allNodes.slice(startIndex, startIndex + limit);
    const nextKey =
      nodes.length === limit && startIndex + limit < allNodes.length
        ? nodes[nodes.length - 1]?.key
        : undefined;

    return { nodes, nextKey, total: allNodes.length };
  }

  async deleteOwnership(realm: string, casKey: string): Promise<boolean> {
    return this.ownership.delete(this.key(realm, casKey));
  }
}
