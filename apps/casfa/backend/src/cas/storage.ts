/**
 * CAS Stack - S3 CAS Storage Operations
 */

import { createHash } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CasStorageInterface } from "../db/memory/types.ts";
import type { CasConfig } from "../types.ts";

// ============================================================================
// CAS Content Types
// ============================================================================

export const CAS_CONTENT_TYPES = {
  CHUNK: "application/octet-stream",
  INLINE_FILE: "application/vnd.cas.inline-file",
  FILE: "application/vnd.cas.file",
  COLLECTION: "application/vnd.cas.collection",
} as const;

// S3 metadata keys (x-amz-meta- prefix is added automatically by SDK)
export const CAS_METADATA_KEYS = {
  CONTENT_TYPE: "cas-content-type", // Original file content type
  SIZE: "cas-size", // Total file size
} as const;

// ============================================================================
// Types
// ============================================================================

export interface CasMetadata {
  casContentType?: string; // Original file content type (for file/inline-file)
  casSize?: number; // Total file size
}

export interface GetResult {
  content: Buffer;
  contentType: string;
  metadata: CasMetadata;
}

export interface PutResult {
  key: string;
  size: number;
  isNew: boolean;
}

// ============================================================================
// CasStorage Class
// ============================================================================

export class CasStorage implements CasStorageInterface {
  private client: S3Client;
  private bucket: string;

  constructor(config: CasConfig, client?: S3Client) {
    this.bucket = config.casBucket;
    this.client = client ?? new S3Client({});
  }

  /**
   * Convert CAS key to S3 key
   * sha256:abcdef... -> cas/sha256/ab/abcdef...
   */
  private toS3Key(casKey: string): string {
    // Remove "sha256:" prefix if present
    const hash = casKey.startsWith("sha256:") ? casKey.slice(7) : casKey;
    const prefix = hash.slice(0, 2);
    return `cas/sha256/${prefix}/${hash}`;
  }

  /**
   * Compute SHA-256 hash of content
   */
  static computeHash(content: Buffer): string {
    const hash = createHash("sha256").update(content).digest("hex");
    return `sha256:${hash}`;
  }

  /**
   * Check if a blob exists in S3
   */
  async exists(casKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(casKey),
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get blob content from S3 with metadata
   */
  async get(casKey: string): Promise<GetResult | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(casKey),
        })
      );

      const content = Buffer.from(await result.Body!.transformToByteArray());
      const contentType = result.ContentType ?? "application/octet-stream";

      // Extract CAS metadata from S3 metadata
      const metadata: CasMetadata = {};
      if (result.Metadata) {
        if (result.Metadata[CAS_METADATA_KEYS.CONTENT_TYPE]) {
          metadata.casContentType = result.Metadata[CAS_METADATA_KEYS.CONTENT_TYPE];
        }
        const sizeStr = result.Metadata[CAS_METADATA_KEYS.SIZE];
        if (sizeStr) {
          metadata.casSize = Number.parseInt(sizeStr, 10);
        }
      }

      return { content, contentType, metadata };
    } catch (error: any) {
      if (error.name === "NoSuchKey" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Put blob content to S3 with optional metadata
   * Returns the CAS key (sha256 hash)
   */
  async put(
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<PutResult> {
    const key = CasStorage.computeHash(content);
    const s3Key = this.toS3Key(key);

    // Check if already exists (global dedup)
    const alreadyExists = await this.exists(key);

    if (!alreadyExists) {
      // Build S3 metadata object
      const s3Metadata: Record<string, string> = {};
      if (metadata?.casContentType) {
        s3Metadata[CAS_METADATA_KEYS.CONTENT_TYPE] = metadata.casContentType;
      }
      if (metadata?.casSize !== undefined) {
        s3Metadata[CAS_METADATA_KEYS.SIZE] = String(metadata.casSize);
      }

      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: s3Key,
          Body: content,
          ContentType: contentType,
          Metadata: Object.keys(s3Metadata).length > 0 ? s3Metadata : undefined,
        })
      );
    }

    return {
      key,
      size: content.length,
      isNew: !alreadyExists,
    };
  }

  /**
   * Put blob with expected key (validates hash) and optional metadata
   * Returns error if hash doesn't match
   */
  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<PutResult | { error: "hash_mismatch"; expected: string; actual: string }> {
    const actualKey = CasStorage.computeHash(content);

    if (actualKey !== expectedKey) {
      return {
        error: "hash_mismatch",
        expected: expectedKey,
        actual: actualKey,
      };
    }

    return this.put(content, contentType, metadata);
  }

  /**
   * Check which keys exist in S3 (for resolve)
   */
  async checkExists(keys: string[]): Promise<{ found: string[]; missing: string[] }> {
    const found: string[] = [];
    const missing: string[] = [];

    // Check in parallel with concurrency limit
    const concurrency = 10;
    for (let i = 0; i < keys.length; i += concurrency) {
      const batch = keys.slice(i, i + concurrency);
      const results = await Promise.all(
        batch.map(async (key) => {
          const exists = await this.exists(key);
          return { key, exists };
        })
      );

      for (const { key, exists } of results) {
        if (exists) {
          found.push(key);
        } else {
          missing.push(key);
        }
      }
    }

    return { found, missing };
  }

  /**
   * Get metadata for a blob (HEAD request, no body)
   */
  async getMetadata(casKey: string): Promise<{
    contentType: string;
    size: number;
    metadata: CasMetadata;
  } | null> {
    try {
      const result = await this.client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(casKey),
        })
      );

      // Extract CAS metadata from S3 metadata
      const metadata: CasMetadata = {};
      if (result.Metadata) {
        if (result.Metadata[CAS_METADATA_KEYS.CONTENT_TYPE]) {
          metadata.casContentType = result.Metadata[CAS_METADATA_KEYS.CONTENT_TYPE];
        }
        const sizeStr = result.Metadata[CAS_METADATA_KEYS.SIZE];
        if (sizeStr) {
          metadata.casSize = Number.parseInt(sizeStr, 10);
        }
      }

      return {
        contentType: result.ContentType ?? "application/octet-stream",
        size: result.ContentLength ?? 0,
        metadata,
      };
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Delete blob from S3
   * Used by GC when all references to a blob are removed
   */
  async delete(casKey: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.toS3Key(casKey),
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }
}
