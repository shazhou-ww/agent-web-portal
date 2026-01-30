/**
 * CAS Client - Types
 */

import type { Readable, Writable } from "node:stream";

// ============================================================================
// Authentication Types
// ============================================================================

export type CasAuth =
  | { type: "user"; token: string }
  | { type: "agent"; token: string }
  | { type: "ticket"; id: string };

// ============================================================================
// Client Configuration
// ============================================================================

export interface CasClientConfig {
  endpoint: string;
  auth: CasAuth;
  storage?: LocalStorageProvider;
  chunkThreshold?: number; // Override server default
}

// ============================================================================
// Context Types (from Agent Runtime)
// ============================================================================

export interface CasBlobContext {
  ticket: string;
  endpoint: string;
  expiresAt: string;
  shard: string;
  scope: string | string[];
  writable:
    | false
    | true
    | {
        quota?: number;
        accept?: string[];
      };
  config: {
    chunkThreshold: number;
  };
}

// ============================================================================
// Node Types (mirrored from cas-stack)
// ============================================================================

export type NodeKind = "collection" | "file" | "chunk";

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
// File Handle Interface
// ============================================================================

export interface CasFileHandle {
  readonly key: string;
  readonly size: number;
  readonly contentType: string;

  /** Stream the entire file content */
  stream(): Promise<Readable>;

  /** Read entire content to buffer (convenience for small files) */
  buffer(): Promise<Buffer>;

  /** Read a range of bytes (supports seeking) */
  slice(start: number, end: number): Promise<Readable>;
}

// ============================================================================
// Path Resolution (for putCollection)
// ============================================================================

export type PathResolution =
  | { type: "file"; content: Buffer | Readable | (() => Readable); contentType: string }
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
  getChunkStream(key: string): Promise<Readable | null>;

  /** Store node metadata */
  putMeta(key: string, node: CasRawNode): Promise<void>;

  /** Get writable stream for storing chunk data */
  putChunkStream(key: string): Writable;

  /** Clean up cache (optional) */
  prune?(options?: { maxSize?: number; maxAge?: number }): Promise<void>;
}

// ============================================================================
// API Response Types
// ============================================================================

export interface CasConfigResponse {
  chunkThreshold: number;
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
