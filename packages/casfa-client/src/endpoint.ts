/**
 * CasfaEndpoint - Single realm CAS storage operations
 *
 * Provides read/write access to a single CAS realm with optional local caching.
 * Can be created from a ticket (for sharing) or from CasfaClient.
 */

import {
  createMemoryStorage,
  createWebCryptoHash,
  writeFile,
  makeDict as coreMakeDict,
  decodeNode,
  hashToKey,
  concatBytes,
  type StorageProvider,
  type HashProvider,
  type CasNode,
  type CasContext,
} from "@agent-web-portal/cas-core";

import type {
  CasfaEndpointConfig,
  EndpointAuth,
  EndpointInfo,
  TreeNodeInfo,
  TreeResponse,
  DictEntry,
  WriteResult,
  CasBlobRef,
} from "./types.ts";
import { VirtualFS } from "./vfs.ts";

/**
 * CasfaEndpoint - operations on a single CAS realm
 */
export class CasfaEndpoint {
  private url: string;
  private auth: EndpointAuth;
  private cache?: StorageProvider;
  private hash: HashProvider;
  private _info?: EndpointInfo;

  constructor(config: CasfaEndpointConfig) {
    this.url = config.url.replace(/\/$/, "");
    this.auth = config.auth;
    this.cache = config.cache;
    this.hash = config.hash ?? createWebCryptoHash();
    this._info = config.info;
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  /**
   * Get endpoint info (fetches from server if not cached)
   */
  async getInfo(): Promise<EndpointInfo> {
    if (this._info) {
      return this._info;
    }

    const res = await this.fetch("");
    if (!res.ok) {
      throw new Error(`Failed to get endpoint info: ${res.status}`);
    }

    this._info = (await res.json()) as EndpointInfo;
    return this._info;
  }

  /**
   * Get the endpoint URL
   */
  getUrl(): string {
    return this.url;
  }

  // ============================================================================
  // Read Operations
  // ============================================================================

  /**
   * Get tree structure starting from a root key
   * Automatically handles pagination
   */
  async getTree(rootKey: string): Promise<Record<string, TreeNodeInfo>> {
    const allNodes: Record<string, TreeNodeInfo> = {};
    let nextKey: string | undefined = rootKey;

    while (nextKey) {
      const res = await this.fetch(`/tree/${encodeURIComponent(nextKey)}`);
      if (!res.ok) {
        throw new Error(`Failed to get tree: ${res.status}`);
      }

      const response = (await res.json()) as TreeResponse;
      Object.assign(allNodes, response.nodes);
      nextKey = response.next;
    }

    return allNodes;
  }

  /**
   * Get raw node bytes (with caching)
   */
  async getRaw(key: string): Promise<Uint8Array> {
    // Check cache first
    if (this.cache) {
      const cached = await this.cache.get(key);
      if (cached) {
        return cached;
      }
    }

    // Fetch from server
    const res = await this.fetch(`/raw/${encodeURIComponent(key)}`);
    if (!res.ok) {
      throw new Error(`Failed to get raw: ${res.status}`);
    }

    const data = new Uint8Array(await res.arrayBuffer());

    // Store in cache
    if (this.cache) {
      await this.cache.put(key, data);
    }

    return data;
  }

  /**
   * Check if a node exists (checks cache first)
   */
  async has(key: string): Promise<boolean> {
    // Check cache
    if (this.cache && (await this.cache.has(key))) {
      return true;
    }

    // Check server
    const res = await this.fetch(`/raw/${encodeURIComponent(key)}`, {
      method: "HEAD",
    });
    return res.ok;
  }

  /**
   * Get decoded node
   */
  async getNode(key: string): Promise<CasNode> {
    const raw = await this.getRaw(key);
    return decodeNode(raw);
  }

  /**
   * Read complete file by traversing B-Tree
   */
  async readFile(key: string): Promise<Uint8Array> {
    const node = await this.getNode(key);
    return this.readNodeData(node);
  }

  private async readNodeData(node: CasNode): Promise<Uint8Array> {
    const parts: Uint8Array[] = [];

    if (node.data && node.data.length > 0) {
      parts.push(node.data);
    }

    if (node.children) {
      for (const childHash of node.children) {
        const childKey = hashToKey(childHash);
        const childNode = await this.getNode(childKey);
        if (childNode.kind === "chunk") {
          parts.push(await this.readNodeData(childNode));
        }
      }
    }

    return concatBytes(...parts);
  }

  /**
   * Stream file content
   */
  async *streamFile(key: string): AsyncIterable<Uint8Array> {
    const node = await this.getNode(key);
    yield* this.streamNodeData(node);
  }

  private async *streamNodeData(node: CasNode): AsyncIterable<Uint8Array> {
    if (node.data && node.data.length > 0) {
      yield node.data;
    }

    if (node.children) {
      for (const childHash of node.children) {
        const childKey = hashToKey(childHash);
        const childNode = await this.getNode(childKey);
        if (childNode.kind === "chunk") {
          yield* this.streamNodeData(childNode);
        }
      }
    }
  }

  /**
   * Resolve a path within a collection to get the target key
   */
  async resolvePath(rootKey: string, path: string): Promise<string> {
    if (path === "." || path === "/" || path === "") {
      return rootKey;
    }

    // Normalize path
    const segments = path
      .split("/")
      .filter((s) => s && s !== ".");

    let currentKey = rootKey;

    for (const segment of segments) {
      const node = await this.getNode(currentKey);
      if (node.kind !== "collection") {
        throw new Error(`Cannot traverse into non-collection node at "${segment}"`);
      }

      // Find child by name
      const childIndex = node.childNames?.indexOf(segment);
      if (childIndex === undefined || childIndex === -1) {
        throw new Error(`Child "${segment}" not found in collection`);
      }

      const childHash = node.children?.[childIndex];
      if (!childHash) {
        throw new Error(`Child hash not found for "${segment}"`);
      }

      currentKey = hashToKey(childHash);
    }

    return currentKey;
  }

  // ============================================================================
  // Write Operations
  // ============================================================================

  /**
   * Upload a file (handles B-Tree splitting automatically)
   */
  async putFile(data: Uint8Array, contentType: string): Promise<WriteResult> {
    // Get endpoint info for nodeLimit
    const info = await this.getInfo();

    // Use cas-core to build the B-Tree locally
    const tempStorage = createMemoryStorage();
    const ctx: CasContext = {
      storage: tempStorage,
      hash: this.hash,
      nodeLimit: info.nodeLimit,
    };

    const result = await writeFile(ctx, data, contentType);

    // Upload all nodes to server
    for (const key of tempStorage.keys()) {
      const nodeData = await tempStorage.get(key);
      if (nodeData) {
        await this.uploadRaw(key, nodeData);
      }
    }

    return result;
  }

  /**
   * Create a dict from existing nodes
   */
  async makeDict(entries: DictEntry[]): Promise<string> {
    // Get endpoint info for nodeLimit
    const info = await this.getInfo();

    // Build temporary storage with child nodes
    const tempStorage = createMemoryStorage();

    for (const entry of entries) {
      const nodeData = await this.getRaw(entry.key);
      await tempStorage.put(entry.key, nodeData);
    }

    const ctx: CasContext = {
      storage: tempStorage,
      hash: this.hash,
      nodeLimit: info.nodeLimit,
    };

    const key = await coreMakeDict(ctx, entries);

    // Upload the dict node
    const dictData = await tempStorage.get(key);
    if (dictData) {
      await this.uploadRaw(key, dictData);
    }

    return key;
  }

  /**
   * Commit a root key to the realm
   */
  async commit(rootKey: string): Promise<void> {
    const res = await this.fetch("/commit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ root: rootKey }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to commit: ${res.status} - ${error}`);
    }
  }

  /**
   * Upload raw node data
   */
  private async uploadRaw(key: string, data: Uint8Array): Promise<void> {
    // Check if already exists (in cache or server)
    if (this.cache && (await this.cache.has(key))) {
      // Likely exists on server too, check with HEAD
      const res = await this.fetch(`/raw/${encodeURIComponent(key)}`, {
        method: "HEAD",
      });
      if (res.ok) {
        return; // Already exists, skip upload
      }
    }

    // Upload to server
    const res = await this.fetch(`/raw/${encodeURIComponent(key)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/octet-stream" },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: data as any,
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to upload raw: ${res.status} - ${error}`);
    }

    // Cache the uploaded data
    if (this.cache) {
      await this.cache.put(key, data);
    }
  }

  // ============================================================================
  // Collection Editing
  // ============================================================================

  /**
   * Edit a collection using virtual filesystem operations
   *
   * @param rootKey - Root collection key to edit (or undefined for empty)
   * @param editor - Async function that performs edits on the VFS
   * @returns New root key after edits
   *
   * @example
   * ```ts
   * const newRoot = await endpoint.editCollection(currentRoot, async (vfs) => {
   *   await vfs.writeFile("docs/readme.md", readmeContent);
   *   await vfs.move("old/path", "new/path");
   *   await vfs.delete("temp/file.txt");
   *   await vfs.mount("libs/external", someExistingKey);
   * });
   * ```
   */
  async editCollection(
    rootKey: string | undefined,
    editor: (vfs: VirtualFS) => Promise<void>
  ): Promise<string> {
    // Create VFS from existing collection or empty
    const vfs = rootKey
      ? await VirtualFS.fromCollection(this, rootKey)
      : VirtualFS.empty(this);

    // Run the editor
    await editor(vfs);

    // Build and return new root
    return vfs.build();
  }

  // ============================================================================
  // Blob Reference
  // ============================================================================

  /**
   * Create a blob reference for a node
   */
  createBlobRef(casNode: string, path: string = ".", pathKey: string = "path"): CasBlobRef {
    return {
      "#cas-endpoint": this.url,
      "cas-node": casNode,
      [pathKey]: path,
    };
  }

  // ============================================================================
  // HTTP Helpers
  // ============================================================================

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.url}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: this.getAuthHeader(),
      },
    });
  }

  private getAuthHeader(): string {
    switch (this.auth.type) {
      case "ticket":
        return `Ticket ${this.auth.id}`;
      case "bearer":
        return `Bearer ${this.auth.token}`;
    }
  }
}
