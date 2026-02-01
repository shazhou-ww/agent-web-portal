/**
 * Memory Storage Provider
 *
 * In-memory implementation of StorageProvider for testing
 */

import type { HashProvider, StorageProvider } from "./types.ts";

/**
 * In-memory storage provider for testing
 */
export class MemoryStorageProvider implements StorageProvider {
  private store = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<void> {
    // Store a copy to avoid mutation issues
    this.store.set(key, new Uint8Array(data));
  }

  async get(key: string): Promise<Uint8Array | null> {
    const data = this.store.get(key);
    return data ? new Uint8Array(data) : null;
  }

  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  /**
   * Get number of stored items (for testing)
   */
  size(): number {
    return this.store.size;
  }

  /**
   * Clear all stored items (for testing)
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Get all keys (for testing)
   */
  keys(): string[] {
    return Array.from(this.store.keys());
  }

  /**
   * Get total bytes stored (for testing)
   */
  totalBytes(): number {
    let total = 0;
    for (const data of this.store.values()) {
      total += data.length;
    }
    return total;
  }
}

/**
 * Web Crypto based hash provider
 * Works in both browser and Node.js (with Web Crypto API)
 */
export class WebCryptoHashProvider implements HashProvider {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const hashBuffer = await crypto.subtle.digest("SHA-256", data as any);
    return new Uint8Array(hashBuffer);
  }
}
