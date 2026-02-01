/**
 * CAS Client Core - Type Definitions
 *
 * Platform-agnostic types for CAS clients
 */

// ============================================================================
// Authentication Types
// ============================================================================

/**
 * Function to sign a request with P256
 * Returns headers: { "X-AWP-Pubkey", "X-AWP-Timestamp", "X-AWP-Signature" }
 */
export type P256SignFn = (
  method: string,
  url: string,
  body?: string
) => Promise<Record<string, string>>;

export type CasAuth =
  | { type: "user"; token: string }
  | { type: "agent"; token: string }
  | { type: "ticket"; id: string }
  | { type: "p256"; sign: P256SignFn };

// ============================================================================
// Client Configuration
// ============================================================================

export interface CasClientConfig {
  endpoint: string;
  auth: CasAuth;
  nodeLimit?: number;
  maxNameBytes?: number;
}

// ============================================================================
// Endpoint Info (from GET /cas/{realm})
// ============================================================================

/**
 * CasEndpointInfo - describes endpoint capabilities and configuration
 */
export interface CasEndpointInfo {
  /** The actual realm (e.g., "usr_xxx") */
  realm: string;

  /** Readable scope: undefined=full access, string[]=only these root keys */
  scope?: string[];

  /** Commit permission: undefined=read-only, object=can commit once */
  commit?: {
    quota?: number;
    accept?: string[];
    root?: string; // already committed root (if set, cannot commit again)
  };

  /** Expiration time (for tickets) */
  expiresAt?: string;

  /** Max size for any node in bytes (default 4MB) */
  nodeLimit: number;

  /** Max file name length in UTF-8 bytes (default 255) */
  maxNameBytes: number;
}

// ============================================================================
// Node Types (mirrored from cas-stack)
// ============================================================================

/**
 * Node kind in CAS structure
 * - chunk: raw data block
 * - inline-file: single-chunk file (content + metadata in one node)
 * - file: multi-chunk file (index node)
 * - collection: directory structure
 */
export type NodeKind = "chunk" | "inline-file" | "file" | "collection";

// Raw node types (storage layer)
export interface CasRawCollectionNode {
  kind: "collection";
  key: string;
  size: number;
  children: Record<string, string>;
}

export interface CasRawFileNode {
  kind: "file";
  key: string;
  size: number;
  contentType: string;
  chunks: string[];
  chunkSizes: number[];
}

export interface CasRawChunkNode {
  kind: "chunk";
  key: string;
  size: number;
  parts?: string[];
}

export type CasRawNode = CasRawCollectionNode | CasRawFileNode | CasRawChunkNode;

// Application node types
export interface CasCollectionNode {
  kind: "collection";
  key: string;
  size: number;
  children: Record<string, CasNode>;
}

export interface CasFileNode {
  kind: "file";
  key: string;
  size: number;
  contentType: string;
}

export type CasNode = CasCollectionNode | CasFileNode;

// ============================================================================
// Blob Reference (for MCP/Tool exchange)
// ============================================================================

/**
 * CAS Blob Reference - used in tool parameters for blob exchange
 *
 * @example
 * ```typescript
 * const ref: CasBlobRef = {
 *   "#cas-endpoint": "https://cas.example.com/api/cas/tkt_abc",
 *   "cas-node": "sha256:...",
 *   "path": "."
 * };
 * ```
 */
export interface CasBlobRef {
  /** CAS endpoint URL with ticket as realm: https://host/api/cas/{ticketId} */
  "#cas-endpoint": string;
  /** DAG root node key */
  "cas-node": string;
  /** Path fields - "." for node itself, "./path/to/file" for collection children */
  [pathKey: string]: string;
}

/**
 * Parsed endpoint URL components
 */
export interface ParsedEndpoint {
  /** Base URL without path (e.g., "https://cas.example.com") */
  baseUrl: string;
  /** Realm identifier (ticket ID or user realm) */
  realm: string;
}

// ============================================================================
// Stream Abstraction (platform-agnostic)
// ============================================================================

/**
 * Platform-agnostic byte stream type
 * Can be converted to/from Node.js Readable or Web ReadableStream
 */
export type ByteStream = AsyncIterable<Uint8Array>;

/**
 * Function to get a byte stream (for lazy loading)
 */
export type ByteStreamFactory = () => ByteStream | Promise<ByteStream>;

// ============================================================================
// File Handle Interface
// ============================================================================

export interface CasFileHandle {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;

  /** Stream the entire file content */
  stream(): Promise<ByteStream>;

  /** Read entire content to Uint8Array (convenience for small files) */
  bytes(): Promise<Uint8Array>;

  /** Read a range of bytes (supports seeking) */
  slice(start: number, end: number): Promise<ByteStream>;
}

// ============================================================================
// Path Resolution (for putCollection)
// ============================================================================

export type PathResolution =
  | { type: "file"; content: Uint8Array | ByteStream | ByteStreamFactory; contentType: string }
  | { type: "collection"; children: string[] }
  | { type: "link"; target: string }
  | null;

export type PathResolver = (path: string) => Promise<PathResolution>;

// ============================================================================
// Local Storage Provider Interface
// ============================================================================

export interface LocalStorageProvider {
  /** Check if a node is cached */
  has(key: string): Promise<boolean>;

  /** Get cached node metadata */
  getMeta(key: string): Promise<CasRawNode | null>;

  /** Get cached chunk data as stream */
  getChunkStream(key: string): Promise<ByteStream | null>;

  /** Store node metadata */
  putMeta(key: string, node: CasRawNode): Promise<void>;

  /** Store chunk data */
  putChunk(key: string, data: Uint8Array): Promise<void>;

  /** Clean up cache (optional) */
  prune?(options?: { maxSize?: number; maxAge?: number }): Promise<void>;
}

// ============================================================================
// API Response Types
// ============================================================================

/** @deprecated Use CasEndpointInfo.nodeLimit instead */
export interface CasConfigResponse {
  nodeLimit: number;
  maxCollectionChildren: number;
  maxPayloadSize: number;
}

export interface PutChunkResponse {
  key: string;
  size: number;
}

export interface PutFileResponse {
  key: string;
}

export interface PutCollectionResponse {
  key: string;
}
