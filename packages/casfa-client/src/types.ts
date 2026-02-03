/**
 * CASFA Client Types
 */

import type { HashProvider, NodeKind, StorageProvider } from "@agent-web-portal/cas-core";

// ============================================================================
// Endpoint Types
// ============================================================================

/**
 * Endpoint authentication
 */
export type EndpointAuth = { type: "ticket"; id: string } | { type: "bearer"; token: string };

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
// Session Types (base authentication layer)
// ============================================================================

/**
 * P256 signing function for request authentication
 * Returns headers: { "X-AWP-Pubkey", "X-AWP-Timestamp", "X-AWP-Signature" }
 */
export type P256SignFn = (
  method: string,
  url: string,
  body?: string
) => Promise<Record<string, string>>;

/**
 * Session authentication - three methods supported
 */
export type SessionAuth =
  | { type: "user"; token: string } // OAuth User Token (Bearer)
  | { type: "agent"; token: string } // Agent Token
  | { type: "p256"; sign: P256SignFn }; // P256 signature

/**
 * CasfaSession configuration
 */
export interface CasfaSessionConfig {
  /** CASFA service base URL: https://api.example.com */
  baseUrl: string;

  /** Authentication method */
  auth: SessionAuth;

  /** Default cache provider (passed to endpoints) */
  cache?: StorageProvider;

  /** Hash provider (defaults to WebCrypto) */
  hash?: HashProvider;
}

// ============================================================================
// Client Types (extends Session with user-only features)
// ============================================================================

/**
 * CasfaClient configuration
 * Only accepts user token (OAuth) authentication
 */
export interface CasfaClientConfig {
  /** CASFA service base URL: https://api.example.com */
  baseUrl: string;

  /** User OAuth token */
  token: string;

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
 * User profile (returned by getProfile)
 */
export interface UserProfile {
  id: string;
  realm: string;
  email?: string;
  isAdmin: boolean;
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
  realm: string;
  email?: string;
  quota: QuotaConfig;
  usage: UsageInfo;
  createdAt: string;
}

// ============================================================================
// Agent Token Types
// ============================================================================

/**
 * Options for creating an agent token
 */
export interface CreateAgentTokenOptions {
  /** Token label/name */
  label: string;

  /** Expiration in seconds (optional) */
  expiresIn?: number;
}

/**
 * Agent token information
 */
export interface AgentTokenInfo {
  id: string;
  label: string;
  token?: string; // Only returned on creation
  createdAt: string;
  expiresAt?: string;
  lastUsedAt?: string;
}

// ============================================================================
// OAuth Client Types
// ============================================================================

/**
 * Options for creating an OAuth client
 */
export interface CreateClientOptions {
  /** Client name */
  name: string;

  /** Redirect URIs */
  redirectUris: string[];

  /** Allowed scopes */
  scopes?: string[];
}

/**
 * Options for updating an OAuth client
 */
export interface UpdateClientOptions {
  /** Client name */
  name?: string;

  /** Redirect URIs */
  redirectUris?: string[];

  /** Allowed scopes */
  scopes?: string[];
}

/**
 * OAuth client information
 */
export interface ClientInfo {
  id: string;
  name: string;
  secret?: string; // Only returned on creation
  redirectUris: string[];
  scopes: string[];
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
 * Dict entry for makeDict
 */
export interface DictEntry {
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

// ============================================================================
// Depot Types
// ============================================================================

/**
 * Depot information
 */
export interface DepotInfo {
  depotId: string;
  name: string;
  root: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

/**
 * Options for creating a depot
 */
export interface CreateDepotOptions {
  name: string;
  description?: string;
}

/**
 * Options for updating a depot root
 */
export interface UpdateDepotOptions {
  root: string;
  message?: string;
}

/**
 * Depot history entry
 */
export interface DepotHistoryEntry {
  version: number;
  root: string;
  createdAt: string;
  message?: string;
}

/**
 * Options for listing depot history
 */
export interface ListHistoryOptions {
  limit?: number;
  cursor?: string;
}

/**
 * Paginated list result
 */
export interface PaginatedResult<T> {
  items: T[];
  cursor?: string;
}
