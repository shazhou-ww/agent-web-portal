/**
 * CAS Providers - Functional implementations
 *
 * Platform-specific implementations for hash and storage providers
 */

import type { HashProvider, StorageProvider } from "./types.ts";

// ============================================================================
// Memory Storage Provider
// ============================================================================

/**
 * Extended storage provider with testing utilities
 */
export type MemoryStorage = StorageProvider & {
  /** Get number of stored items */
  size: () => number;
  /** Clear all stored items */
  clear: () => void;
  /** Get all keys */
  keys: () => string[];
  /** Get total bytes stored */
  totalBytes: () => number;
};

/**
 * Create an in-memory storage provider for testing
 */
export const createMemoryStorage = (): MemoryStorage => {
  const store = new Map<string, Uint8Array>();

  return {
    put: async (key: string, data: Uint8Array): Promise<void> => {
      // Store a copy to avoid mutation issues
      store.set(key, new Uint8Array(data));
    },

    get: async (key: string): Promise<Uint8Array | null> => {
      const data = store.get(key);
      return data ? new Uint8Array(data) : null;
    },

    has: async (key: string): Promise<boolean> => {
      return store.has(key);
    },

    size: (): number => {
      return store.size;
    },

    clear: (): void => {
      store.clear();
    },

    keys: (): string[] => {
      return Array.from(store.keys());
    },

    totalBytes: (): number => {
      let total = 0;
      for (const data of store.values()) {
        total += data.length;
      }
      return total;
    },
  };
};

// ============================================================================
// Web Crypto Hash Provider (Fallback for testing)
// ============================================================================

/**
 * Create a Web Crypto based hash provider (truncated SHA-256 for testing)
 * Works in both browser and Node.js (with Web Crypto API)
 *
 * NOTE: This is a fallback implementation for testing purposes.
 * Production code should inject a proper BLAKE3s-128 implementation.
 */
export const createWebCryptoHash = (): HashProvider => ({
  hash: async (data: Uint8Array): Promise<Uint8Array> => {
    // This handles both regular ArrayBuffer and SharedArrayBuffer backing
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    // Truncate to 16 bytes (128 bits) to match BLAKE3s-128 output size
    return new Uint8Array(hashBuffer).slice(0, 16);
  },
});
