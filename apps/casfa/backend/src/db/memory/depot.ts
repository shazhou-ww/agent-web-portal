/**
 * Memory Depot Storage
 *
 * In-memory implementation of DepotDb for local development.
 */

import type { DepotHistoryRecord, DepotRecord, IDepotDb } from "./types.ts";

// Default empty collection key
const EMPTY_COLLECTION_KEY =
  "sha256:a78577c5cfc47ab3e4b116f01902a69e2e015b40cdef52f9b552cfb5104e769a";

// Default depot name
const MAIN_DEPOT_NAME = "main";

export class MemoryDepotDb implements IDepotDb {
  private depots = new Map<string, DepotRecord>();
  private history = new Map<string, DepotHistoryRecord[]>();

  private buildKey(realm: string, depotId: string): string {
    return `${realm}#${depotId}`;
  }

  async create(
    realm: string,
    options: { name: string; root?: string; description?: string }
  ): Promise<DepotRecord> {
    const depotId = `dpt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    const depot: DepotRecord = {
      realm,
      depotId,
      name: options.name,
      root: options.root || EMPTY_COLLECTION_KEY,
      version: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description,
    };
    this.depots.set(this.buildKey(realm, depotId), depot);

    // Add initial history
    const historyKey = this.buildKey(realm, depotId);
    this.history.set(historyKey, [
      {
        realm,
        depotId,
        version: 1,
        root: depot.root,
        createdAt: now,
        message: "Initial version",
      },
    ]);

    return depot;
  }

  async get(realm: string, depotId: string): Promise<DepotRecord | null> {
    return this.depots.get(this.buildKey(realm, depotId)) ?? null;
  }

  async getByName(realm: string, name: string): Promise<DepotRecord | null> {
    for (const depot of this.depots.values()) {
      if (depot.realm === realm && depot.name === name) {
        return depot;
      }
    }
    return null;
  }

  async list(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ depots: DepotRecord[]; nextKey?: string }> {
    const limit = options?.limit ?? 100;
    const realmDepots = Array.from(this.depots.values())
      .filter((d) => d.realm === realm)
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, limit);
    return { depots: realmDepots };
  }

  async updateRoot(
    realm: string,
    depotId: string,
    newRoot: string,
    message?: string
  ): Promise<{ depot: DepotRecord; history: DepotHistoryRecord }> {
    const depot = this.depots.get(this.buildKey(realm, depotId));
    if (!depot) {
      throw new Error("Depot not found");
    }

    const now = Date.now();
    depot.root = newRoot;
    depot.version += 1;
    depot.updatedAt = now;

    const historyRecord: DepotHistoryRecord = {
      realm,
      depotId,
      version: depot.version,
      root: newRoot,
      createdAt: now,
      message,
    };

    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    historyList.push(historyRecord);
    this.history.set(historyKey, historyList);

    return { depot, history: historyRecord };
  }

  async delete(realm: string, depotId: string): Promise<boolean> {
    const key = this.buildKey(realm, depotId);
    this.history.delete(key);
    return this.depots.delete(key);
  }

  async listHistory(
    realm: string,
    depotId: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ history: DepotHistoryRecord[]; nextKey?: string }> {
    const limit = options?.limit ?? 50;
    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    const sorted = [...historyList].sort((a, b) => b.version - a.version).slice(0, limit);
    return { history: sorted };
  }

  async getHistory(
    realm: string,
    depotId: string,
    version: number
  ): Promise<DepotHistoryRecord | null> {
    const historyKey = this.buildKey(realm, depotId);
    const historyList = this.history.get(historyKey) ?? [];
    return historyList.find((h) => h.version === version) ?? null;
  }

  async ensureMainDepot(realm: string, emptyCollectionKey: string): Promise<DepotRecord> {
    const existing = await this.getByName(realm, MAIN_DEPOT_NAME);
    if (existing) {
      return existing;
    }
    return await this.create(realm, {
      name: MAIN_DEPOT_NAME,
      root: emptyCollectionKey,
      description: "Default depot",
    });
  }
}
