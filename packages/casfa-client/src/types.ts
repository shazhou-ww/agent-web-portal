/**
 * CASFA Client Types
 */

import type { StorageProvider, HashProvider, NodeKind } from "@agent-web-portal/cas-core";

// ============================================================================
// Endpoint Types
// ============================================================================

/**
 * Endpoint authentication
 */
export type EndpointAuth =
  | { type: "ticket"; id: string }
  | { type: "bearer"; token: string };

/**
 * Endpoint capabilities and configuration
 */
export interface EndpointInfo {
  /** The realm this endpoint accesses */
  realm: string;

  /** Maximum node size in bytes */
  nodeLimit: number;

  /** Maximum file name length in UTF-8 bytes */
  maxNameBytes: number;

  /** Readable scope: undefined = full access, string[] = only these root keys */
  scope?: string[];

  /** Commit permission */
  commit?: {
    /** Maximum bytes that can be committed */
    quota?: number;
    /** Allowed content types */
    accept?: string[];
    /** Already committed root (if set, cannot commit again) */
    root?: string;
  };

  /** Expiration time (for tickets) */
  expiresAt?: string;
}

/**
 * CasfaEndpoint configuration
 */
export interface CasfaEndpointConfig {
  /** Full endpoint URL: https://api.example.com/cas/{realm} */
  url: string;

  /** Authentication */
  auth: EndpointAuth;

  /** Local cache storage provider */
  cache?: StorageProvider;

  /** Hash provider (defaults to WebCrypto) */
  hash?: HashProvider;

  /** Endpoint info (fetched automatically if not provided) */
  info?: EndpointInfo;
}

// ============================================================================
// Client Types
// ============================================================================

/**
 * Client authentication (full service access)
 */
export type ClientAuth =
  | { type: "user"; token: string }
  | { type: "agent"; token: string }
  | { type: "admin"; token: string };

/**
 * CasfaClient configuration
 */
export interface CasfaClientConfig {
  /** CASFA service base URL: https://api.example.com */
  baseUrl: string;

  /** Authentication */
  auth: ClientAuth;

  /** Default cache provider (passed to endpoints) */
  cache?: StorageProvider;

  /** Hash provider (defaults to WebCrypto) */
  hash?: HashProvider;
}

// ============================================================================
// Ticket Types
// ============================================================================

/**
 * Options for creating a ticket
 */
export interface CreateTicketOptions {
  /** Target realm (defaults to @me) */
  realm?: string;

  /** Accessible root keys (undefined = all) */
  scope?: string[];

  /** Write permission */
  commit?: {
    quota?: number;
    accept?: string[];
  };

  /** Expiration in seconds */
  expiresIn?: number;

  /** Label/note for the ticket */
  label?: string;
}

/**
 * Ticket information
 */
export interface TicketInfo {
  id: string;
  realm: string;
  scope?: string[];
  commit?: {
    quota?: number;
    accept?: string[];
    root?: string;
  };
  expiresAt: string;
  createdAt: string;
  label?: string;
}

// ============================================================================
// User Types
// ============================================================================

/**
 * User profile
 */
export interface UserProfile {
  id: string;
  email?: string;
  quota: QuotaConfig;
  usage: UsageInfo;
}

/**
 * Storage usage information
 */
export interface UsageInfo {
  bytesUsed: number;
  nodesCount: number;
}

/**
 * Quota configuration
 */
export interface QuotaConfig {
  maxBytes: number;
  maxNodes: number;
}

/**
 * User info (for admin API)
 */
export interface UserInfo {
  id: string;
  email?: string;
  quota: QuotaConfig;
  usage: UsageInfo;
  createdAt: string;
}

// ============================================================================
// CAS Node Types (for tree responses)
// ============================================================================

/**
 * Tree node info
 */
export interface TreeNodeInfo {
  kind: NodeKind;
  size: number;
  contentType?: string;
  children?: string[];
  childNames?: string[];
}

/**
 * Tree response
 */
export interface TreeResponse {
  nodes: Record<string, TreeNodeInfo>;
  next?: string;
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
  key: string;
  size: number;
  nodeCount: number;
}

// ============================================================================
// Blob Reference Types
// ============================================================================

/**
 * CAS Blob Reference
 */
export interface CasBlobRef {
  "#cas-endpoint": string;
  "cas-node": string;
  [key: string]: string;
}
