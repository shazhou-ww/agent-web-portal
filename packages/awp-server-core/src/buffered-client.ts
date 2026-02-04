/**
 * AWP Server Core - Buffered CAS Client
 *
 * A CAS client wrapper that buffers write operations in memory
 * and commits them all at once when the tool execution completes.
 */

import {
  type ByteStream,
  CAS_CONTENT_TYPES,
  CasClient,
  type CasEndpointInfo,
  type CasFileHandle,
  collectBytes,
  computeKey,
  type LocalStorageProvider,
  needsChunking,
  type PathResolver,
  type RawResponse,
  splitIntoChunks,
  type TreeNodeInfo,
} from "@agent-web-portal/cas-client-core";

import type { IBufferedCasClient } from "./types.ts";
import { CommitError } from "./types.ts";

/**
 * Pending chunk write
 */
interface PendingChunk {
  key: string;
  data: Uint8Array;
}

/**
 * Pending file node write
 */
interface PendingFile {
  key: string;
  chunks: string[];
  contentType: string;
  size: number;
}

/**
 * Pending collection node write
 */
interface PendingCollection {
  key: string;
  children: Record<string, string>;
}

/**
 * BufferedCasClient - wraps CasClient with buffered writes
 *
 * All read operations are passed through to the underlying CasClient.
 * All write operations are buffered in memory until commit() is called.
 */
export class BufferedCasClient implements IBufferedCasClient {
  private client: CasClient;
  private nodeLimit: number;

  // Buffered writes
  private pendingChunks: Map<string, PendingChunk> = new Map();
  private pendingFiles: Map<string, PendingFile> = new Map();
  private pendingCollections: Map<string, PendingCollection> = new Map();

  // Track all pending node keys for quick lookup
  private allPendingKeys: Set<string> = new Set();

  // Root key of the last write operation (for single-root commit)
  private rootKey: string | null = null;

  constructor(
    endpointInfo: CasEndpointInfo,
    baseUrl: string,
    realm: string,
    storage?: LocalStorageProvider
  ) {
    this.client = CasClient.fromEndpointInfo(baseUrl, realm, endpointInfo, storage);
    this.nodeLimit = endpointInfo.nodeLimit;

    console.log("[BufferedCasClient] Created with:", {
      baseUrl,
      realm,
      actualRealm: endpointInfo.realm,
      nodeLimit: this.nodeLimit,
    });
  }

  // ============================================================================
  // Read Operations (passthrough with pending node support)
  // ============================================================================

  async openFile(key: string): Promise<CasFileHandle> {
    // Check if this is a pending file
    const pendingFile = this.pendingFiles.get(key);
    if (pendingFile) {
      return this.createPendingFileHandle(pendingFile);
    }
    return this.client.openFile(key);
  }

  /**
   * Get tree structure with pending nodes included
   */
  async getTree(rootKey: string): Promise<Record<string, TreeNodeInfo>> {
    // First check if root is a pending node
    if (this.allPendingKeys.has(rootKey)) {
      // Build tree from pending nodes
      const result: Record<string, TreeNodeInfo> = {};
      await this.collectPendingTree(rootKey, result);
      return result;
    }

    // Use client's getTree
    return this.client.getTree(rootKey);
  }

  /**
   * Recursively collect pending nodes into a tree
   */
  private async collectPendingTree(
    key: string,
    result: Record<string, TreeNodeInfo>
  ): Promise<void> {
    if (result[key]) return; // Already visited

    const pendingFile = this.pendingFiles.get(key);
    if (pendingFile) {
      result[key] = {
        kind: "file",
        size: pendingFile.size,
        contentType: pendingFile.contentType,
        chunks: pendingFile.chunks.length,
      };
      return;
    }

    const pendingCollection = this.pendingCollections.get(key);
    if (pendingCollection) {
      result[key] = {
        kind: "collection",
        size: 0, // Will be computed
        children: pendingCollection.children,
      };
      // Recursively collect children
      for (const childKey of Object.values(pendingCollection.children)) {
        await this.collectPendingTree(childKey, result);
      }
      return;
    }

    // Not a pending node - try to get from client
    try {
      const tree = await this.client.getTree(key);
      Object.assign(result, tree);
    } catch {
      // Node not found
    }
  }

  async getRaw(key: string): Promise<RawResponse> {
    // Check pending chunks
    const pendingChunk = this.pendingChunks.get(key);
    if (pendingChunk) {
      // Copy the data to ensure we have a proper ArrayBuffer
      const data = new ArrayBuffer(pendingChunk.data.byteLength);
      new Uint8Array(data).set(pendingChunk.data);
      return {
        data,
        contentType: CAS_CONTENT_TYPES.CHUNK,
      };
    }

    // Check pending files (inline files)
    const pendingFile = this.pendingFiles.get(key);
    if (pendingFile && pendingFile.chunks.length === 1) {
      const chunkKey = pendingFile.chunks[0]!;
      const chunk = this.pendingChunks.get(chunkKey);
      if (chunk) {
        // Copy the data to ensure we have a proper ArrayBuffer
        const data = new ArrayBuffer(chunk.data.byteLength);
        new Uint8Array(data).set(chunk.data);
        return {
          data,
          contentType: CAS_CONTENT_TYPES.INLINE_FILE,
          casContentType: pendingFile.contentType,
          casSize: pendingFile.size,
        };
      }
    }

    return this.client.getRaw(key);
  }

  // ============================================================================
  // Buffered Write Operations
  // ============================================================================

  /**
   * Buffer a file for later commit
   *
   * @param content - File content as Uint8Array or ByteStream
   * @param contentType - MIME type of the content
   * @returns The computed CAS key (file is not actually uploaded yet)
   */
  async putFile(content: Uint8Array | ByteStream, contentType: string): Promise<string> {
    // Collect stream to bytes if needed
    const bytes = content instanceof Uint8Array ? content : await collectBytes(content);

    // Check if chunking is needed
    if (!needsChunking(bytes.length, this.nodeLimit)) {
      // Small file: single chunk
      const chunkKey = await computeKey(bytes);
      this.pendingChunks.set(chunkKey, { key: chunkKey, data: bytes });
      this.allPendingKeys.add(chunkKey);

      // Create file node referencing the chunk
      const fileKey = await this.computeFileKey([chunkKey], contentType, bytes.length);
      this.pendingFiles.set(fileKey, {
        key: fileKey,
        chunks: [chunkKey],
        contentType,
        size: bytes.length,
      });
      this.allPendingKeys.add(fileKey);
      this.rootKey = fileKey;

      return fileKey;
    }

    // Large file: split into chunks
    const chunkDataList = splitIntoChunks(bytes, this.nodeLimit);
    const chunkKeys: string[] = [];

    for (const chunkData of chunkDataList) {
      const chunkKey = await computeKey(chunkData);
      this.pendingChunks.set(chunkKey, { key: chunkKey, data: chunkData });
      this.allPendingKeys.add(chunkKey);
      chunkKeys.push(chunkKey);
    }

    // Create file node referencing all chunks
    const fileKey = await this.computeFileKey(chunkKeys, contentType, bytes.length);
    this.pendingFiles.set(fileKey, {
      key: fileKey,
      chunks: chunkKeys,
      contentType,
      size: bytes.length,
    });
    this.allPendingKeys.add(fileKey);
    this.rootKey = fileKey;

    return fileKey;
  }

  /**
   * Buffer a collection for later commit
   *
   * @param resolver - Path resolver function
   * @returns The computed CAS key (collection is not actually uploaded yet)
   */
  async putCollection(resolver: PathResolver): Promise<string> {
    const rootKey = await this.buildNode("/", resolver);
    if (!rootKey) {
      throw new Error("Root path resolution returned null");
    }
    this.rootKey = rootKey;
    return rootKey;
  }

  /**
   * Recursively build and buffer nodes from path resolver
   */
  private async buildNode(path: string, resolver: PathResolver): Promise<string | null> {
    const resolution = await resolver(path);
    if (!resolution) {
      return null;
    }

    switch (resolution.type) {
      case "file": {
        let content: Uint8Array;
        if (resolution.content instanceof Uint8Array) {
          content = resolution.content;
        } else if (typeof resolution.content === "function") {
          const stream = await resolution.content();
          content = await collectBytes(stream);
        } else {
          content = await collectBytes(resolution.content);
        }
        return this.putFile(content, resolution.contentType);
      }

      case "link": {
        // Link to existing key - no buffering needed
        return resolution.target;
      }

      case "collection": {
        const children: Record<string, string> = {};

        for (const name of resolution.children) {
          const childPath = path === "/" ? `/${name}` : `${path}/${name}`;
          const childKey = await this.buildNode(childPath, resolver);
          if (childKey) {
            children[name] = childKey;
          }
        }

        return this.bufferCollection(children);
      }
    }
  }

  /**
   * Buffer a collection node
   */
  private async bufferCollection(children: Record<string, string>): Promise<string> {
    const collectionKey = await this.computeCollectionKey(children);
    this.pendingCollections.set(collectionKey, {
      key: collectionKey,
      children,
    });
    this.allPendingKeys.add(collectionKey);
    return collectionKey;
  }

  // ============================================================================
  // Commit / Discard
  // ============================================================================

  /**
   * Commit all buffered writes to CAS
   *
   * Uses the unified POST /commit endpoint:
   * 1. Upload all chunks in parallel
   * 2. Call POST /commit with files and collections
   * 3. Handle missing_nodes response with retry
   *
   * Returns the keys of all committed nodes
   */
  async commit(): Promise<string[]> {
    if (!this.hasPendingWrites()) {
      return [];
    }

    const maxRetries = 3;
    let retryCount = 0;

    while (retryCount < maxRetries) {
      try {
        // 1. Upload all chunks in parallel
        const chunkUploads = Array.from(this.pendingChunks.values()).map(async (chunk) => {
          await this.uploadChunk(chunk.key, chunk.data);
        });
        await Promise.all(chunkUploads);

        // 2. Build commit payload
        const files: Record<string, { chunks: string[]; contentType: string; size: number }> = {};
        const collections: Record<string, { children: Record<string, string>; size: number }> = {};

        for (const file of this.pendingFiles.values()) {
          files[file.key] = {
            chunks: file.chunks,
            contentType: file.contentType,
            size: file.size,
          };
        }

        for (const collection of this.pendingCollections.values()) {
          // Calculate size from children
          let size = 0;
          for (const childKey of Object.values(collection.children)) {
            const file = this.pendingFiles.get(childKey);
            if (file) {
              size += file.size;
            }
            // Note: nested collections size would need recursive calculation
          }
          collections[collection.key] = {
            children: collection.children,
            size,
          };
        }

        // Determine root key
        const root = this.rootKey;
        if (!root) {
          throw new Error("No root key set for commit");
        }

        // 3. Call POST /commit
        const result = await this.postCommit(root, files, collections);

        if (result.success) {
          const committedKeys = result.committed ?? [];
          // Clear pending writes on success
          this.discard();
          return committedKeys;
        }

        // Handle missing nodes - retry after uploading missing chunks
        if (result.error === "missing_nodes" && result.missing) {
          console.warn(
            `[BufferedCasClient] Missing nodes detected, retry ${retryCount + 1}/${maxRetries}:`,
            result.missing
          );

          // Check if missing nodes are chunks we have
          const missingChunks = result.missing.filter((key: string) => this.pendingChunks.has(key));
          if (missingChunks.length === 0) {
            throw new Error(
              `Missing nodes that are not pending chunks: ${result.missing.join(", ")}`
            );
          }

          // Re-upload missing chunks
          for (const key of missingChunks) {
            const chunk = this.pendingChunks.get(key);
            if (chunk) {
              await this.uploadChunk(chunk.key, chunk.data);
            }
          }

          retryCount++;
          continue;
        }

        throw new Error(`Commit failed: ${result.error}`);
      } catch (error) {
        if (retryCount >= maxRetries - 1) {
          throw new CommitError(error instanceof Error ? error.message : String(error));
        }
        retryCount++;
        console.warn(`[BufferedCasClient] Commit error, retry ${retryCount}/${maxRetries}:`, error);
      }
    }

    throw new CommitError(`Failed to commit after ${maxRetries} retries`);
  }

  /**
   * POST /commit to CAS server
   */
  private async postCommit(
    root: string,
    files: Record<string, { chunks: string[]; contentType: string; size: number }>,
    collections: Record<string, { children: Record<string, string>; size: number }>
  ): Promise<{
    success: boolean;
    root?: string;
    committed?: string[];
    error?: string;
    missing?: string[];
  }> {
    const apiBase = this.client.getApiBaseUrl();

    const body: Record<string, unknown> = { root };
    if (Object.keys(files).length > 0) {
      body.files = files;
    }
    if (Object.keys(collections).length > 0) {
      body.collections = collections;
    }

    const res = await fetch(`${apiBase}/commit`, {
      method: "POST",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Commit request failed: ${res.status} - ${error}`);
    }

    return res.json();
  }

  /**
   * Discard all buffered writes without committing
   */
  discard(): void {
    this.pendingChunks.clear();
    this.pendingFiles.clear();
    this.pendingCollections.clear();
    this.allPendingKeys.clear();
    this.rootKey = null;
  }

  // ============================================================================
  // Status
  // ============================================================================

  hasPendingWrites(): boolean {
    return this.allPendingKeys.size > 0;
  }

  getPendingKeys(): string[] {
    return Array.from(this.allPendingKeys);
  }

  getRootKey(): string | null {
    return this.rootKey;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Compute file node key (deterministic based on chunks and metadata)
   * Must match CAS server's file node format exactly
   */
  private async computeFileKey(
    chunks: string[],
    contentType: string,
    size: number
  ): Promise<string> {
    // Must match CAS server format: { kind: "file", chunks, contentType, size }
    const metadata = JSON.stringify({ kind: "file", chunks, contentType, size });
    const encoder = new TextEncoder();
    return computeKey(encoder.encode(metadata));
  }

  /**
   * Compute collection node key (deterministic based on children)
   *
   * NOTE: This does NOT match CAS server format exactly (server includes size).
   * The key returned here is used locally, and the actual key is returned by the server.
   * For collections, we rely on the server's returned key after upload.
   */
  private async computeCollectionKey(children: Record<string, string>): Promise<string> {
    // Use sorted entries for deterministic key
    const sorted = Object.entries(children).sort(([a], [b]) => a.localeCompare(b));
    const metadata = JSON.stringify(sorted);
    const encoder = new TextEncoder();
    return computeKey(encoder.encode(metadata));
  }

  /**
   * Create a file handle for a pending file
   */
  private createPendingFileHandle(file: PendingFile): CasFileHandle {
    const self = this;

    return {
      get key() {
        return file.key;
      },
      get size() {
        return file.size;
      },
      get contentType() {
        return file.contentType;
      },

      async stream(): Promise<ByteStream> {
        // Concatenate all chunk data
        const chunks: Uint8Array[] = [];
        for (const chunkKey of file.chunks) {
          const pending = self.pendingChunks.get(chunkKey);
          if (pending) {
            chunks.push(pending.data);
          }
        }

        return (async function* () {
          for (const chunk of chunks) {
            yield chunk;
          }
        })();
      },

      async bytes(): Promise<Uint8Array> {
        const chunks: Uint8Array[] = [];
        for (const chunkKey of file.chunks) {
          const pending = self.pendingChunks.get(chunkKey);
          if (pending) {
            chunks.push(pending.data);
          }
        }

        if (chunks.length === 1) {
          return chunks[0]!;
        }

        const totalSize = chunks.reduce((acc, c) => acc + c.length, 0);
        const result = new Uint8Array(totalSize);
        let offset = 0;
        for (const chunk of chunks) {
          result.set(chunk, offset);
          offset += chunk.length;
        }
        return result;
      },

      async slice(start: number, end: number): Promise<ByteStream> {
        const full = await this.bytes();
        const sliced = full.slice(start, end);
        return (async function* () {
          yield sliced;
        })();
      },
    };
  }

  /**
   * Upload a chunk to CAS
   */
  private async uploadChunk(key: string, data: Uint8Array): Promise<void> {
    const apiBase = this.client.getApiBaseUrl();

    // Create a new ArrayBuffer copy to satisfy Blob type requirements
    const arrayBuffer = new ArrayBuffer(data.length);
    new Uint8Array(arrayBuffer).set(data);
    const res = await fetch(`${apiBase}/chunk/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/octet-stream",
      },
      body: new Blob([arrayBuffer]),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to upload chunk ${key}: ${res.status} - ${error}`);
    }
  }

  /**
   * Get authorization header
   */
  private getAuthHeader(): string {
    const auth = (this.client as unknown as { auth: { type: string; id?: string; token?: string } })
      .auth;
    switch (auth.type) {
      case "user":
        return `Bearer ${auth.token}`;
      case "agent":
        return `Agent ${auth.token}`;
      case "ticket":
        return `Ticket ${auth.id}`;
      default:
        throw new Error(`Unknown auth type: ${auth.type}`);
    }
  }
}
