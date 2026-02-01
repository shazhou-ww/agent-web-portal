/**
 * CAS Binary Format Types
 */

/**
 * Node kind discriminator
 */
export type NodeKind = "chunk" | "collection";

/**
 * Hash provider interface - injected by platform-specific implementations
 */
export interface HashProvider {
  /**
   * Compute SHA-256 hash of data
   * @param data - Input bytes
   * @returns 32-byte hash as Uint8Array
   */
  sha256(data: Uint8Array): Promise<Uint8Array>;
}

/**
 * Storage provider interface - injected by platform-specific implementations
 * Server uses S3, Client uses HTTP, tests use in-memory
 */
export interface StorageProvider {
  /**
   * Store data by key
   * @param key - CAS key (e.g., "sha256:...")
   * @param data - Raw bytes to store
   */
  put(key: string, data: Uint8Array): Promise<void>;

  /**
   * Retrieve data by key
   * @param key - CAS key
   * @returns Raw bytes or null if not found
   */
  get(key: string): Promise<Uint8Array | null>;

  /**
   * Check if key exists
   * @param key - CAS key
   * @returns true if key exists
   */
  has(key: string): Promise<boolean>;
}

/**
 * Parsed CAS node header (32 bytes)
 */
export interface CasHeader {
  /** Magic number (0x01534143) */
  magic: number;
  /** Flag bits */
  flags: number;
  /** Number of children */
  count: number;
  /** Logical size (file size for chunks, total size for collections) */
  size: number;
  /** Offset to NAMES section (0 if none) */
  namesOffset: number;
  /** Offset to CONTENT-TYPE section (0 if none) */
  typeOffset: number;
  /** Offset to DATA section (0 if none) */
  dataOffset: number;
}

/**
 * Decoded CAS node
 */
export interface CasNode {
  /** Node type */
  kind: NodeKind;
  /** Logical size */
  size: number;
  /** MIME type (optional) */
  contentType?: string;
  /** Child hashes (32 bytes each) */
  children?: Uint8Array[];
  /** Child names (collection only, same order as children) */
  childNames?: string[];
  /** Raw data (chunk only) */
  data?: Uint8Array;
}

/**
 * Chunk node for encoding
 */
export interface ChunkInput {
  /** File content type */
  contentType?: string;
  /** Raw data bytes */
  data: Uint8Array;
  /** Child chunk hashes (for B-Tree internal nodes) */
  children?: Uint8Array[];
}

/**
 * Collection node for encoding
 */
export interface CollectionInput {
  /** Content type (typically "inode/directory" or omitted) */
  contentType?: string;
  /** Total size of all descendants */
  size: number;
  /** Child hashes (32 bytes each) */
  children: Uint8Array[];
  /** Child names (same order as children) */
  childNames: string[];
}

/**
 * B-Tree layout node description
 */
export interface LayoutNode {
  /** Depth of this node (1 = leaf) */
  depth: number;
  /** Data bytes stored in this node */
  dataSize: number;
  /** Child layouts (empty for leaf nodes) */
  children: LayoutNode[];
}

/**
 * Encoded node result
 */
export interface EncodedNode {
  /** Raw bytes of the encoded node */
  bytes: Uint8Array;
  /** SHA-256 hash of the bytes */
  hash: Uint8Array;
}
