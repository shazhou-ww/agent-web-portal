/**
 * S3 Storage Provider for CAS
 *
 * Implements StorageProvider interface from cas-core with:
 * - LRU cache for key existence checks
 * - S3 backend storage
 */

import { createHash } from "node:crypto";
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { HashProvider, StorageProvider } from "@agent-web-portal/cas-core";

/**
 * Simple LRU cache for key existence
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private readonly maxSize: number;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
    this.cache.set(key, value);
  }

  has(key: K): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * S3 Storage Provider configuration
 */
export interface S3StorageProviderConfig {
  /** S3 bucket name */
  bucket: string;
  /** Optional S3 client (for testing) */
  client?: S3Client;
  /** LRU cache size for key existence (default: 10000) */
  cacheSize?: number;
  /** Key prefix in S3 (default: "cas/sha256/") */
  prefix?: string;
}

/**
 * S3-backed StorageProvider implementation
 */
export class S3StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  private prefix: string;
  private existsCache: LRUCache<string, boolean>;

  constructor(config: S3StorageProviderConfig) {
    this.client = config.client ?? new S3Client({});
    this.bucket = config.bucket;
    this.prefix = config.prefix ?? "cas/sha256/";
    this.existsCache = new LRUCache(config.cacheSize ?? 10000);
  }

  /**
   * Convert CAS key to S3 key
   * sha256:abcdef... -> cas/sha256/ab/abcdef...
   */
  private toS3Key(casKey: string): string {
    const hash = casKey.startsWith("sha256:") ? casKey.slice(7) : casKey;
    const prefix = hash.slice(0, 2);
    return `${this.prefix}${prefix}/${hash}`;
  }

  /**
   * Check if a key exists
   */
  async has(key: string): Promise<boolean> {
    // Check cache first
    const cached = this.existsCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // Check S3
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(key),
        })
      );
      this.existsCache.set(key, true);
      return true;
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        // Don't cache non-existence (it might be uploaded later)
        return false;
      }
      throw error;
    }
  }

  /**
   * Get blob content from S3
   */
  async get(key: string): Promise<Uint8Array | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(key),
        })
      );

      const bytes = await result.Body!.transformToByteArray();
      
      // Mark as existing in cache
      this.existsCache.set(key, true);
      
      return new Uint8Array(bytes);
    } catch (error: any) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Put blob content to S3
   * The key must be the correct hash of the content
   */
  async put(key: string, value: Uint8Array): Promise<void> {
    const s3Key = this.toS3Key(key);

    // Check cache first (avoid redundant writes)
    if (this.existsCache.get(key)) {
      return;
    }

    // Check if already exists in S3
    const exists = await this.has(key);
    if (exists) {
      return;
    }

    // Upload to S3
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: s3Key,
        Body: value,
        ContentType: "application/octet-stream",
      })
    );

    // Mark as existing
    this.existsCache.set(key, true);
  }

  /**
   * Clear the existence cache (for testing)
   */
  clearCache(): void {
    this.existsCache.clear();
  }

  /**
   * Get cache statistics (for debugging)
   */
  getCacheStats(): { size: number } {
    return { size: this.existsCache.size };
  }
}

/**
 * Node.js crypto-based HashProvider
 */
export class NodeHashProvider implements HashProvider {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hash = createHash("sha256").update(data).digest();
    return new Uint8Array(hash);
  }
}
