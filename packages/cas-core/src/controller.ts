/**
 * CAS Controller
 *
 * High-level interface for CAS operations, matching CASFA API granularity.
 * Uses injected StorageProvider and HashProvider for platform abstraction.
 */

import { DEFAULT_NODE_LIMIT, HASH_SIZE, HEADER_SIZE } from "./constants.ts";
import { decodeNode, encodeChunk, encodeChunkWithSize, encodeCollection } from "./node.ts";
import { computeDepth, computeLayout, computeUsableSpace } from "./topology.ts";
import type {
  CasNode,
  CollectionInput,
  EncodedNode,
  HashProvider,
  LayoutNode,
  NodeKind,
  StorageProvider,
} from "./types.ts";
import { concatBytes, hashToKey } from "./utils.ts";

/**
 * Controller configuration
 */
export interface CasControllerConfig {
  /** Storage provider for reading/writing nodes */
  storage: StorageProvider;
  /** Hash provider for SHA-256 computation */
  hash: HashProvider;
  /** Maximum node size in bytes (default: 1MB) */
  nodeLimit?: number;
}

/**
 * Tree node info returned by getTree
 */
export interface TreeNodeInfo {
  kind: NodeKind;
  size: number;
  contentType?: string;
  children?: string[];
  childNames?: string[];
}

/**
 * Tree response from getTree
 */
export interface TreeResponse {
  nodes: Record<string, TreeNodeInfo>;
}

/**
 * Collection entry for uploadCollection
 */
export interface CollectionEntry {
  name: string;
  key: string;
}

/**
 * Upload result
 */
export interface UploadResult {
  /** Root key of the uploaded content */
  key: string;
  /** Total size in bytes */
  size: number;
  /** Number of nodes created */
  nodeCount: number;
}

/**
 * CAS Controller - high-level interface for CAS operations
 */
export class CasController {
  private storage: StorageProvider;
  private hash: HashProvider;
  private nodeLimit: number;

  constructor(config: CasControllerConfig) {
    this.storage = config.storage;
    this.hash = config.hash;
    this.nodeLimit = config.nodeLimit ?? DEFAULT_NODE_LIMIT;
  }

  // ============================================================================
  // File Upload (with automatic B-Tree splitting)
  // ============================================================================

  /**
   * Upload a file, automatically splitting into B-Tree if needed
   * @param data - File content
   * @param contentType - MIME type
   * @returns Upload result with root key
   */
  async uploadFile(data: Uint8Array, contentType: string): Promise<UploadResult> {
    const size = data.length;
    const layout = computeLayout(size, this.nodeLimit);
    const nodeCount = this.countNodes(layout);

    const rootHash = await this.uploadFileNode(data, 0, contentType, layout);
    const key = hashToKey(rootHash);

    return { key, size, nodeCount };
  }

  /**
   * Recursively upload a file node according to layout
   */
  private async uploadFileNode(
    data: Uint8Array,
    offset: number,
    contentType: string,
    layout: LayoutNode
  ): Promise<Uint8Array> {
    // Extract this node's data portion
    const nodeData = data.slice(offset, offset + layout.dataSize);

    if (layout.children.length === 0) {
      // Leaf node: just data, no children
      const encoded = await encodeChunkWithSize(
        { data: nodeData, contentType },
        layout.dataSize,
        this.hash
      );
      await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
      return encoded.hash;
    }

    // Internal node: upload children first, then this node
    const childHashes: Uint8Array[] = [];
    let childOffset = offset + layout.dataSize;

    for (const childLayout of layout.children) {
      const childHash = await this.uploadFileNode(data, childOffset, contentType, childLayout);
      childHashes.push(childHash);
      childOffset += this.computeLayoutTotalSize(childLayout);
    }

    // Compute total size for this subtree
    const totalSize = this.computeLayoutTotalSize(layout);

    // Encode this node with children
    const encoded = await encodeChunkWithSize(
      { data: nodeData, contentType, children: childHashes },
      totalSize,
      this.hash
    );
    await this.storage.put(hashToKey(encoded.hash), encoded.bytes);

    return encoded.hash;
  }

  /**
   * Upload a raw chunk (for cases where caller handles splitting)
   */
  async uploadChunk(data: Uint8Array, contentType?: string): Promise<string> {
    const encoded = await encodeChunk({ data, contentType }, this.hash);
    await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
    return hashToKey(encoded.hash);
  }

  // ============================================================================
  // Collection Upload
  // ============================================================================

  /**
   * Upload a collection (directory)
   * @param entries - Array of {name, key} entries
   * @param totalSize - Total size of all children (for metadata)
   * @returns Collection key
   */
  async uploadCollection(entries: CollectionEntry[], totalSize: number): Promise<string> {
    // Convert keys to hashes
    const children: Uint8Array[] = [];
    const childNames: string[] = [];

    for (const entry of entries) {
      children.push(this.keyToHash(entry.key));
      childNames.push(entry.name);
    }

    const input: CollectionInput = {
      size: totalSize,
      children,
      childNames,
    };

    const encoded = await encodeCollection(input, this.hash);
    await this.storage.put(hashToKey(encoded.hash), encoded.bytes);

    return hashToKey(encoded.hash);
  }

  // ============================================================================
  // Reading Operations
  // ============================================================================

  /**
   * Get tree structure starting from a key
   * @param rootKey - Root node key
   * @param limit - Maximum nodes to return (default 1000)
   * @returns Tree response with node info
   */
  async getTree(rootKey: string, limit = 1000): Promise<TreeResponse> {
    const nodes: Record<string, TreeNodeInfo> = {};
    const queue: string[] = [rootKey];

    while (queue.length > 0 && Object.keys(nodes).length < limit) {
      const key = queue.shift()!;

      // Skip if already processed
      if (nodes[key]) continue;

      const data = await this.storage.get(key);
      if (!data) continue;

      const node = decodeNode(data);
      const childKeys = node.children?.map((h) => hashToKey(h));

      const info: TreeNodeInfo = {
        kind: node.kind,
        size: node.size,
      };

      if (node.contentType) {
        info.contentType = node.contentType;
      }

      if (childKeys && childKeys.length > 0) {
        info.children = childKeys;
      }

      if (node.childNames && node.childNames.length > 0) {
        info.childNames = node.childNames;
      }

      nodes[key] = info;

      // Add children to queue for BFS traversal
      if (childKeys) {
        for (const childKey of childKeys) {
          if (!nodes[childKey]) {
            queue.push(childKey);
          }
        }
      }
    }

    return { nodes };
  }

  /**
   * Get raw chunk data
   * @param key - Node key
   * @returns Raw bytes or null if not found
   */
  async getChunk(key: string): Promise<Uint8Array | null> {
    return this.storage.get(key);
  }

  /**
   * Get decoded node
   * @param key - Node key
   * @returns Decoded CasNode or null if not found
   */
  async getNode(key: string): Promise<CasNode | null> {
    const data = await this.storage.get(key);
    if (!data) return null;
    return decodeNode(data);
  }

  /**
   * Read file content by traversing B-Tree
   * @param key - Root chunk key
   * @returns Complete file data
   */
  async readFile(key: string): Promise<Uint8Array | null> {
    const node = await this.getNode(key);
    if (!node || node.kind !== "chunk") return null;

    return this.readChunkNode(node);
  }

  /**
   * Recursively read chunk node data
   */
  private async readChunkNode(node: CasNode): Promise<Uint8Array> {
    // Collect this node's data
    const parts: Uint8Array[] = [];

    if (node.data) {
      parts.push(node.data);
    }

    // Recursively read children
    if (node.children) {
      for (const childHash of node.children) {
        const childKey = hashToKey(childHash);
        const childNode = await this.getNode(childKey);
        if (childNode && childNode.kind === "chunk") {
          const childData = await this.readChunkNode(childNode);
          parts.push(childData);
        }
      }
    }

    return concatBytes(...parts);
  }

  /**
   * Open file as readable stream (for large files)
   * @param key - Root chunk key
   * @returns ReadableStream of file content
   */
  openFileStream(key: string): ReadableStream<Uint8Array> {
    const controller = this;

    return new ReadableStream({
      async start(streamController) {
        const node = await controller.getNode(key);
        if (!node || node.kind !== "chunk") {
          streamController.close();
          return;
        }

        await controller.streamChunkNode(node, streamController);
        streamController.close();
      },
    });
  }

  /**
   * Recursively stream chunk node data
   */
  private async streamChunkNode(
    node: CasNode,
    streamController: ReadableStreamDefaultController<Uint8Array>
  ): Promise<void> {
    // Emit this node's data
    if (node.data && node.data.length > 0) {
      streamController.enqueue(node.data);
    }

    // Recursively stream children
    if (node.children) {
      for (const childHash of node.children) {
        const childKey = hashToKey(childHash);
        const childNode = await this.getNode(childKey);
        if (childNode && childNode.kind === "chunk") {
          await this.streamChunkNode(childNode, streamController);
        }
      }
    }
  }

  // ============================================================================
  // Utility Methods
  // ============================================================================

  /**
   * Check if a key exists in storage
   */
  async has(key: string): Promise<boolean> {
    return this.storage.has(key);
  }

  /**
   * Get the node limit
   */
  getNodeLimit(): number {
    return this.nodeLimit;
  }

  /**
   * Compute total data size from layout
   */
  private computeLayoutTotalSize(layout: LayoutNode): number {
    let total = layout.dataSize;
    for (const child of layout.children) {
      total += this.computeLayoutTotalSize(child);
    }
    return total;
  }

  /**
   * Count nodes in layout
   */
  private countNodes(layout: LayoutNode): number {
    let count = 1;
    for (const child of layout.children) {
      count += this.countNodes(child);
    }
    return count;
  }

  /**
   * Convert key string to hash bytes
   */
  private keyToHash(key: string): Uint8Array {
    if (!key.startsWith("sha256:")) {
      throw new Error(`Invalid key format: ${key}`);
    }
    const hex = key.slice(7);
    const bytes = new Uint8Array(HASH_SIZE);
    for (let i = 0; i < HASH_SIZE; i++) {
      bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }
}
