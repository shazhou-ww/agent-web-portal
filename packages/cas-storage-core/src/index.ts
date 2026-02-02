/**
 * CAS Storage Core
 *
 * Core types and utilities for CAS storage providers.
 */

// Types
export type { StorageProvider, HashProvider, StorageConfig } from "./types.ts"

// Key utilities
export {
  extractHash,
  toKey,
  hexToBytes,
  bytesToHex,
  isValidKey,
  toStoragePath,
} from "./key.ts"

// LRU Cache
export { createLRUCache, DEFAULT_CACHE_SIZE, type LRUCache } from "./lru-cache.ts"
