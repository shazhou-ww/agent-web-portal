/**
 * Memory Commits Storage
 *
 * In-memory implementation of CommitsDb for local development.
 */

import type { CommitRecord, ICommitsDb } from "./types.ts";

export class MemoryCommitsDb implements ICommitsDb {
  private commits = new Map<string, CommitRecord>();

  private buildKey(realm: string, root: string): string {
    return `${realm}#${root}`;
  }

  async create(
    realm: string,
    root: string,
    createdBy: string,
    title?: string
  ): Promise<CommitRecord> {
    const commit: CommitRecord = {
      realm,
      root,
      title,
      createdAt: Date.now(),
      createdBy,
    };
    this.commits.set(this.buildKey(realm, root), commit);
    return commit;
  }

  async get(realm: string, root: string): Promise<CommitRecord | null> {
    return this.commits.get(this.buildKey(realm, root)) ?? null;
  }

  async list(
    realm: string,
    options?: { limit?: number }
  ): Promise<{ commits: CommitRecord[]; nextKey?: string }> {
    const limit = options?.limit ?? 100;
    const realmCommits = Array.from(this.commits.values())
      .filter((c) => c.realm === realm)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
    return { commits: realmCommits };
  }

  // Alias for compatibility with CommitsDb
  async listByScan(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ commits: CommitRecord[]; nextKey?: string }> {
    return this.list(realm, options);
  }

  async updateTitle(realm: string, root: string, title?: string): Promise<boolean> {
    const commit = this.commits.get(this.buildKey(realm, root));
    if (!commit) return false;
    commit.title = title;
    return true;
  }

  async delete(realm: string, root: string): Promise<boolean> {
    return this.commits.delete(this.buildKey(realm, root));
  }
}
