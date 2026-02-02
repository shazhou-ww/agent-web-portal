/**
 * In-memory implementation of CommitsDb for testing
 */

import type { Commit } from "../types.ts"
import type { CommitsDb } from "../db/commits.ts"

// ============================================================================
// Factory
// ============================================================================

export const createMemoryCommitsDb = (): CommitsDb & { _store: Map<string, Commit>; _clear: () => void } => {
  const store = new Map<string, Commit>()

  const makeKey = (realm: string, root: string) => `${realm}#${root}`

  const create = async (
    realm: string,
    root: string,
    createdBy: string,
    title?: string
  ): Promise<Commit> => {
    const now = Date.now()
    const commit: Commit = {
      realm,
      root,
      title,
      createdAt: now,
      createdBy,
    }

    store.set(makeKey(realm, root), commit)
    return commit
  }

  const get = async (realm: string, root: string): Promise<Commit | null> => {
    return store.get(makeKey(realm, root)) ?? null
  }

  const update = async (
    realm: string,
    root: string,
    updates: { title?: string }
  ): Promise<Commit | null> => {
    const commit = store.get(makeKey(realm, root))
    if (!commit) return null

    const updatedCommit: Commit = {
      ...commit,
      title: updates.title,
    }

    store.set(makeKey(realm, root), updatedCommit)
    return updatedCommit
  }

  const deleteCommit = async (realm: string, root: string): Promise<boolean> => {
    const key = makeKey(realm, root)
    if (!store.has(key)) return false
    store.delete(key)
    return true
  }

  const list = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ commits: Commit[]; nextKey?: string }> => {
    const limit = options.limit ?? 100
    const commits: Commit[] = []

    for (const commit of store.values()) {
      if (commit.realm === realm) {
        commits.push(commit)
      }
    }

    // Sort by createdAt descending (newest first)
    commits.sort((a, b) => b.createdAt - a.createdAt)

    // Handle pagination
    let startIndex = 0
    if (options.startKey) {
      const startIdx = commits.findIndex((c) => c.root === options.startKey)
      if (startIdx >= 0) startIndex = startIdx + 1
    }

    const pagedCommits = commits.slice(startIndex, startIndex + limit)
    const nextKey = startIndex + limit < commits.length ? commits[startIndex + limit]?.root : undefined

    return { commits: pagedCommits, nextKey }
  }

  return {
    create,
    get,
    update,
    delete: deleteCommit,
    list,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
