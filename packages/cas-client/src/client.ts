/**
 * CAS Client - Main Client Implementation
 */

import { PassThrough, Readable } from "node:stream";
import { computeKey, needsChunking, splitIntoChunks, streamToBuffer } from "./chunker.ts";
import { CasFileHandleImpl } from "./file-handle.ts";
import type {
  CasAuth,
  CasBlobContext,
  CasClientConfig,
  CasConfigResponse,
  CasFileHandle,
  CasNode,
  CasRawFileNode,
  CasRawNode,
  LocalStorageProvider,
  PathResolver,
} from "./types.ts";

/**
 * CAS Client for interacting with CAS storage
 */
export class CasClient {
  private endpoint: string;
  private auth: CasAuth;
  private storage?: LocalStorageProvider;
  private chunkThreshold: number;
  private shard?: string;

  constructor(config: CasClientConfig) {
    this.endpoint = config.endpoint.replace(/\/$/, ""); // Remove trailing slash
    this.auth = config.auth;
    this.storage = config.storage;
    this.chunkThreshold = config.chunkThreshold ?? 1048576; // Default 1MB
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  static fromUserToken(endpoint: string, token: string): CasClient {
    return new CasClient({
      endpoint,
      auth: { type: "user", token },
    });
  }

  static fromAgentToken(endpoint: string, token: string): CasClient {
    return new CasClient({
      endpoint,
      auth: { type: "agent", token },
    });
  }

  static fromTicket(endpoint: string, ticketId: string): CasClient {
    return new CasClient({
      endpoint,
      auth: { type: "ticket", id: ticketId },
    });
  }

  static fromContext(context: CasBlobContext, storage?: LocalStorageProvider): CasClient {
    const client = new CasClient({
      endpoint: context.endpoint,
      auth: { type: "ticket", id: context.ticket },
      storage,
      chunkThreshold: context.config.chunkThreshold,
    });
    client.shard = context.shard;
    return client;
  }

  // ============================================================================
  // Authentication
  // ============================================================================

  private getAuthHeader(): string {
    switch (this.auth.type) {
      case "user":
        return `Bearer ${this.auth.token}`;
      case "agent":
        return `Agent ${this.auth.token}`;
      case "ticket":
        return `Ticket ${this.auth.id}`;
    }
  }

  private async getShard(): Promise<string> {
    if (this.shard) {
      return this.shard;
    }
    // For user/agent tokens, use @me which server will resolve
    return "@me";
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get server configuration
   */
  async getConfig(): Promise<CasConfigResponse> {
    const res = await fetch(`${this.endpoint}/cas/config`);
    if (!res.ok) {
      throw new Error(`Failed to get config: ${res.status}`);
    }
    return res.json() as Promise<CasConfigResponse>;
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  /**
   * Get application layer node (CasNode)
   */
  async getNode(key: string): Promise<CasNode> {
    const shard = await this.getShard();
    const res = await fetch(`${this.endpoint}/cas/${shard}/node/${encodeURIComponent(key)}`, {
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!res.ok) {
      throw new Error(`Failed to get node: ${res.status}`);
    }

    return res.json() as Promise<CasNode>;
  }

  /**
   * Get storage layer node (CasRawNode)
   */
  async getRawNode(key: string): Promise<CasRawNode> {
    // Check local cache first
    if (this.storage) {
      const cached = await this.storage.getMeta(key);
      if (cached) {
        return cached;
      }
    }

    const shard = await this.getShard();
    const res = await fetch(`${this.endpoint}/cas/${shard}/raw/${encodeURIComponent(key)}`, {
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!res.ok) {
      throw new Error(`Failed to get raw node: ${res.status}`);
    }

    const node = (await res.json()) as CasRawNode;

    // Cache the metadata
    if (this.storage) {
      await this.storage.putMeta(key, node);
    }

    return node;
  }

  /**
   * Open a file for streaming read
   */
  async openFile(key: string): Promise<CasFileHandle> {
    const rawNode = await this.getRawNode(key);

    if (rawNode.kind !== "file") {
      throw new Error(`Expected file node, got ${rawNode.kind}`);
    }

    return new CasFileHandleImpl(rawNode as CasRawFileNode, (chunkKey) =>
      this.getChunkStream(chunkKey)
    );
  }

  /**
   * Get chunk data as a stream
   */
  async getChunkStream(key: string): Promise<Readable> {
    // Check local cache first
    if (this.storage) {
      const cached = await this.storage.getChunkStream(key);
      if (cached) {
        return cached;
      }
    }

    const shard = await this.getShard();
    const res = await fetch(`${this.endpoint}/cas/${shard}/chunk/${encodeURIComponent(key)}`, {
      headers: { Authorization: this.getAuthHeader() },
    });

    if (!res.ok) {
      throw new Error(`Failed to get chunk: ${res.status}`);
    }

    // Convert web stream to Node stream
    const webStream = res.body;
    if (!webStream) {
      throw new Error("No response body");
    }

    const nodeStream = Readable.fromWeb(webStream as any);

    // Optionally cache while streaming
    if (this.storage) {
      const passThrough = new PassThrough();
      const cacheStream = this.storage.putChunkStream(key);

      nodeStream.pipe(cacheStream);
      nodeStream.pipe(passThrough);

      return passThrough;
    }

    return nodeStream;
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  /**
   * Upload a file (handles chunking automatically)
   */
  async putFile(content: Buffer | Readable, contentType: string): Promise<string> {
    // Convert stream to buffer if needed
    const buffer = Buffer.isBuffer(content) ? content : await streamToBuffer(content);

    const _shard = await this.getShard();

    // Check if chunking is needed
    if (!needsChunking(buffer.length, this.chunkThreshold)) {
      // Small file: upload as single chunk, then create file node
      const chunkKey = await this.uploadChunk(buffer);
      return this.createFileNode([chunkKey], contentType, buffer.length);
    }

    // Large file: split into chunks and upload
    const chunks = splitIntoChunks(buffer, this.chunkThreshold);
    const chunkKeys: string[] = [];

    for (const chunk of chunks) {
      const key = await this.uploadChunk(chunk);
      chunkKeys.push(key);
    }

    return this.createFileNode(chunkKeys, contentType, buffer.length);
  }

  /**
   * Upload a single chunk
   */
  private async uploadChunk(content: Buffer): Promise<string> {
    const key = computeKey(content);
    const shard = await this.getShard();

    const res = await fetch(`${this.endpoint}/cas/${shard}/chunk/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/octet-stream",
      },
      body: content,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to upload chunk: ${res.status} - ${error}`);
    }

    const result = (await res.json()) as { key: string };
    return result.key;
  }

  /**
   * Create a file node referencing uploaded chunks
   */
  private async createFileNode(
    chunks: string[],
    contentType: string,
    totalSize: number
  ): Promise<string> {
    const shard = await this.getShard();

    const res = await fetch(`${this.endpoint}/cas/${shard}/file`, {
      method: "PUT",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ chunks, contentType }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create file node: ${res.status} - ${error}`);
    }

    const result = (await res.json()) as { key: string };
    return result.key;
  }

  /**
   * Upload a collection using a path resolver callback
   */
  async putCollection(resolver: PathResolver): Promise<string> {
    const rootKey = await this.buildNode("/", resolver);
    if (!rootKey) {
      throw new Error("Root path resolution returned null");
    }
    return rootKey;
  }

  /**
   * Recursively build and upload nodes from path resolver
   */
  private async buildNode(path: string, resolver: PathResolver): Promise<string | null> {
    const resolution = await resolver(path);
    if (!resolution) {
      return null;
    }

    switch (resolution.type) {
      case "file": {
        // Get content
        let content: Buffer;
        if (Buffer.isBuffer(resolution.content)) {
          content = resolution.content;
        } else if (typeof resolution.content === "function") {
          const stream = resolution.content();
          content = await streamToBuffer(stream);
        } else {
          content = await streamToBuffer(resolution.content);
        }

        return this.putFile(content, resolution.contentType);
      }

      case "link": {
        // Return existing key directly
        return resolution.target;
      }

      case "collection": {
        // Build children first
        const children: Record<string, string> = {};

        for (const name of resolution.children) {
          const childPath = path === "/" ? `/${name}` : `${path}/${name}`;
          const childKey = await this.buildNode(childPath, resolver);
          if (childKey) {
            children[name] = childKey;
          }
        }

        // Upload collection node
        return this.createCollectionNode(children);
      }
    }
  }

  /**
   * Create a collection node
   */
  private async createCollectionNode(children: Record<string, string>): Promise<string> {
    const shard = await this.getShard();

    const res = await fetch(`${this.endpoint}/cas/${shard}/collection`, {
      method: "PUT",
      headers: {
        Authorization: this.getAuthHeader(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ children }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create collection node: ${res.status} - ${error}`);
    }

    const result = (await res.json()) as { key: string };
    return result.key;
  }
}
