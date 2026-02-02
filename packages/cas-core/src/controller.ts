/**
 * CAS Controller
 *
 * High-level interface for CAS operations, matching CASFA API granularity.
 * Uses injected StorageProvider and HashProvider for platform abstraction.
 */

import { DEFAULT_NODE_LIMIT, HASH_SIZE, HEADER_SIZE } from "./constants.ts";
import { decodeNode, encodeDictNode, encodeFileNode, encodeFileNodeWithSize, encodeSuccessorNodeWithSize } from "./node.ts";
import { computeDepth, computeLayout, computeUsableSpace } from "./topology.ts";
import type {
  CasNode,
  DictNodeInput,
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
 * Collection entry for makeCollection
 */
export interface CollectionEntry {
  name: string;
  key: string;
}

/**
 * Write result
 */
export interface WriteResult {
  /** Root key of the written content */
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
  // File Write (with automatic B-Tree splitting)
  // ============================================================================

  /**
   * Write a file, automatically splitting into B-Tree if needed
   * @param data - File content
   * @param contentType - MIME type
   * @returns Write result with root key
   */
  async writeFile(data: Uint8Array, contentType: string): Promise<WriteResult> {
    const size = data.length;
    const layout = computeLayout(size, this.nodeLimit);
    const nodeCount = this.countNodes(layout);

    const rootHash = await this.uploadFileNode(data, 0, contentType, layout);
    const key = hashToKey(rootHash);

    return { key, size, nodeCount };
  }

  /**
   * Recursively upload a file node according to layout
   * Uses f-node for root (with contentType), s-node for children
   */
  private async uploadFileNode(
    data: Uint8Array,
    offset: number,
    contentType: string,
    layout: LayoutNode,
    isRoot: boolean = true
  ): Promise<Uint8Array> {
    // Extract this node's data portion
    const nodeData = data.slice(offset, offset + layout.dataSize);

    if (layout.children.length === 0) {
      // Leaf node: no children
      if (isRoot) {
        // Root leaf: use f-node with contentType
        const encoded = await encodeFileNodeWithSize(
          { data: nodeData, contentType },
          layout.dataSize,
          this.hash
        );
        await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
        return encoded.hash;
      } else {
        // Non-root leaf: use s-node (no contentType)
        const encoded = await encodeSuccessorNodeWithSize(
          { data: nodeData },
          layout.dataSize,
          this.hash
        );
        await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
        return encoded.hash;
      }
    }

    // Internal node: upload children first, then this node
    const childHashes: Uint8Array[] = [];
    let childOffset = offset + layout.dataSize;

    for (const childLayout of layout.children) {
      // Children are always s-nodes (not root)
      const childHash = await this.uploadFileNode(data, childOffset, contentType, childLayout, false);
      childHashes.push(childHash);
      childOffset += this.computeLayoutTotalSize(childLayout);
    }

    // Compute total size for this subtree
    const totalSize = this.computeLayoutTotalSize(layout);

    if (isRoot) {
      // Root internal: use f-node with children and contentType
      const encoded = await encodeFileNodeWithSize(
        { data: nodeData, contentType, children: childHashes },
        totalSize,
        this.hash
      );
      await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
      return encoded.hash;
    } else {
      // Non-root internal: use s-node with children
      const encoded = await encodeSuccessorNodeWithSize(
        { data: nodeData, children: childHashes },
        totalSize,
        this.hash
      );
      await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
      return encoded.hash;
    }
  }

  /**
   * Put a raw file node (for cases where caller handles splitting)
   */
  async putFileNode(data: Uint8Array, contentType?: string): Promise<string> {
    const encoded = await encodeFileNode({ data, contentType }, this.hash);
    await this.storage.put(hashToKey(encoded.hash), encoded.bytes);
    return hashToKey(encoded.hash);
  }

  // ============================================================================
  // Collection Creation
  // ============================================================================

  /**
   * Make a collection (directory) from existing nodes
   * Size is automatically computed from children
   * Children are automatically sorted by name (UTF-8 byte order)
   * @param entries - Array of {name, key} entries
   * @returns Collection key (d-node)
   */
  async makeCollection(entries: CollectionEntry[]): Promise<string> {
    // Convert keys to hashes and compute total size
    const children: Uint8Array[] = [];
    const childNames: string[] = [];
    let totalSize = 0;

    for (const entry of entries) {
      children.push(this.keyToHash(entry.key));
      childNames.push(entry.name);
      // Get child node to compute size
      const childNode = await this.getNode(entry.key);
      if (childNode) {
        totalSize += childNode.size;
      }
    }

    const input: DictNodeInput = {
      size: totalSize,
      children,
      childNames,
    };

    const encoded = await encodeDictNode(input, this.hash);
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
   * @param key - Root file node key (f-node)
   * @returns Complete file data
   */
  async readFile(key: string): Promise<Uint8Array | null> {
    const node = await this.getNode(key);
    if (!node) return null;
    // Accept both f-node and s-node for reading
    if (node.kind !== "file" && node.kind !== "successor") return null;

    return this.readFileNode(node);
  }

  /**
   * Recursively read file/successor node data
   */
  private async readFileNode(node: CasNode): Promise<Uint8Array> {
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
        if (childNode && (childNode.kind === "file" || childNode.kind === "successor")) {
          const childData = await this.readFileNode(childNode);
          parts.push(childData);
        }
      }
    }

    return concatBytes(...parts);
  }

  /**
   * Open file as readable stream (for large files)
   * @param key - Root file node key (f-node)
   * @returns ReadableStream of file content
   */
  openFileStream(key: string): ReadableStream<Uint8Array> {
    const controller = this;

    return new ReadableStream({
      async start(streamController) {
        const node = await controller.getNode(key);
        if (!node) {
          streamController.close();
          return;
        }
        if (node.kind !== "file" && node.kind !== "successor") {
          streamController.close();
          return;
        }

        await controller.streamFileNode(node, streamController);
        streamController.close();
      },
    });
  }

  /**
   * Recursively stream file/successor node data
   */
  private async streamFileNode(
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
        if (childNode && (childNode.kind === "file" || childNode.kind === "successor")) {
          await this.streamFileNode(childNode, streamController);
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
