/**
 * Memory CAS Storage
 *
 * In-memory and file-based implementations of CasStorage for local development.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { CasMetadata, CasStorageEntry, CasStorageInterface } from "./types.ts";

function computeCasHash(content: Buffer): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

/**
 * In-memory CAS storage (no persistence)
 */
export class MemoryCasStorage implements CasStorageInterface {
  private blobs = new Map<string, CasStorageEntry>();

  async exists(casKey: string): Promise<boolean> {
    return this.blobs.has(casKey);
  }

  async get(
    casKey: string
  ): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null> {
    const entry = this.blobs.get(casKey);
    if (!entry) return null;
    return {
      content: entry.content,
      contentType: entry.contentType,
      metadata: entry.metadata,
    };
  }

  async put(
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<{ key: string; size: number; isNew: boolean }> {
    const key = computeCasHash(content);
    const isNew = !this.blobs.has(key);
    if (isNew) {
      this.blobs.set(key, { content, contentType, metadata: metadata ?? {} });
    }
    return { key, size: content.length, isNew };
  }

  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  > {
    const actualKey = computeCasHash(content);
    if (actualKey !== expectedKey) {
      return { error: "hash_mismatch", expected: expectedKey, actual: actualKey };
    }
    return this.put(content, contentType, metadata);
  }
}

/**
 * File-based CAS storage for local development with persistence
 */
export class FileCasStorage implements CasStorageInterface {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    // Ensure base directory exists
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(casKey: string): string {
    // casKey format: "sha256:abcd1234..."
    // Store in subdirectories based on first 2 chars of hash for better file system performance
    const hashPart = casKey.replace("sha256:", "");
    const subDir = hashPart.substring(0, 2);
    return path.join(this.baseDir, subDir, hashPart);
  }

  private getMetaPath(casKey: string): string {
    return `${this.getFilePath(casKey)}.meta.json`;
  }

  async exists(casKey: string): Promise<boolean> {
    return fs.existsSync(this.getFilePath(casKey));
  }

  async get(
    casKey: string
  ): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null> {
    const filePath = this.getFilePath(casKey);
    const metaPath = this.getMetaPath(casKey);

    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath);
    let contentType = "application/octet-stream";
    let metadata: CasMetadata = {};

    if (fs.existsSync(metaPath)) {
      try {
        const metaData = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
        contentType = metaData.contentType || contentType;
        metadata = metaData.metadata || metadata;
      } catch {
        // Ignore meta read errors, use defaults
      }
    }

    return { content, contentType, metadata };
  }

  async put(
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<{ key: string; size: number; isNew: boolean }> {
    const key = computeCasHash(content);
    const filePath = this.getFilePath(key);
    const metaPath = this.getMetaPath(key);
    const isNew = !fs.existsSync(filePath);

    if (isNew) {
      // Ensure subdirectory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write content file
      fs.writeFileSync(filePath, content);

      // Write metadata file
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            contentType,
            metadata: metadata ?? {},
            createdAt: new Date().toISOString(),
          },
          null,
          2
        )
      );
    }

    return { key, size: content.length, isNew };
  }

  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream",
    metadata?: CasMetadata
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  > {
    const actualKey = computeCasHash(content);
    if (actualKey !== expectedKey) {
      return { error: "hash_mismatch", expected: expectedKey, actual: actualKey };
    }
    return this.put(content, contentType, metadata);
  }
}
