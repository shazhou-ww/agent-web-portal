/**
 * CASFA v2 - Type Definitions
 *
 * All types use `type` instead of `interface` for consistency.
 */

import type { NodeKind as CasNodeKind } from "@agent-web-portal/cas-core";
import type { Context } from "hono";

// Re-export NodeKind from cas-core
export type NodeKind = CasNodeKind;

// ============================================================================
// CAS Content Types and Metadata Keys
// ============================================================================

export const CAS_CONTENT_TYPES = {
  CHUNK: "application/octet-stream",
  INLINE_FILE: "application/vnd.cas.inline-file",
  FILE: "application/vnd.cas.file",
  COLLECTION: "application/vnd.cas.collection",
} as const;

export type CasContentType = (typeof CAS_CONTENT_TYPES)[keyof typeof CAS_CONTENT_TYPES];

export const CAS_HEADERS = {
  CONTENT_TYPE: "X-CAS-Content-Type",
  SIZE: "X-CAS-Size",
  KIND: "X-CAS-Kind",
} as const;

// ============================================================================
// Token Types
// ============================================================================

export type TokenType = "user" | "agent" | "ticket";

export type BaseToken = {
  pk: string;
  sk: string;
  type: TokenType;
  createdAt: number;
  expiresAt: number;
};

export type UserToken = BaseToken & {
  type: "user";
  userId: string;
  refreshToken?: string;
};

export type AgentToken = BaseToken & {
  type: "agent";
  userId: string;
  name: string;
  description?: string;
};

export type CommitConfig = {
  quota?: number;
  accept?: string[];
  root?: string;
};

export type Ticket = BaseToken & {
  type: "ticket";
  realm: string;
  issuerId: string;
  /**
   * Fingerprint of the issuer for permission verification.
   * - AWP Client: base64(xxh64('pubkey:${pubkey}'))
   * - Agent Token: base64(xxh64('token:${token}'))
   * - User Token: undefined (created by user directly)
   */
  issuerFingerprint?: string;
  /** Human-readable task description */
  purpose?: string;
  /** Input node keys (readable scope) */
  scope?: string[];
  /** Write permission config */
  commit?: CommitConfig;
  /** Whether ticket is revoked */
  isRevoked?: boolean;
  config: {
    nodeLimit: number;
    maxNameBytes: number;
  };
  /** GSI for realm queries */
  gsi1pk?: string;
  gsi1sk?: string;
};

export type Token = UserToken | AgentToken | Ticket;

// ============================================================================
// User Role
// ============================================================================

export type UserRole = "unauthorized" | "authorized" | "admin";

// ============================================================================
// Auth Context
// ============================================================================

/**
 * Identity type for the authenticated caller
 */
export type IdentityType = "user" | "agent" | "awp" | "ticket";

export type AuthContext = {
  token: Token;
  userId: string;
  realm: string;
  canRead: boolean;
  canWrite: boolean;
  canIssueTicket: boolean;
  role?: UserRole;
  canManageUsers?: boolean;
  allowedScope?: string[];
  /**
   * Identity type for logging and auditing
   */
  identityType: IdentityType;
  /**
   * Unique fingerprint for the caller identity (for logging/auditing).
   * - User: base64(xxh64('user:${userId}'))
   * - Agent Token: base64(xxh64('token:${tokenId}'))
   * - AWP Client: base64(xxh64('pubkey:${pubkey}'))
   * - Ticket: base64(xxh64('ticket:${ticketId}'))
   */
  fingerprint: string;
  /**
   * Whether this is an agent-level identity (Agent Token or AWP Client).
   * Agent identities can only revoke tickets they issued.
   */
  isAgent: boolean;
};

// ============================================================================
// CAS Types
// ============================================================================

export type GcStatus = "active" | "pending";

export type CasOwnership = {
  realm: string;
  key: string;
  kind?: NodeKind;
  createdAt: number;
  createdBy: string;
  contentType?: string;
  size: number;
};

export type RefCount = {
  realm: string;
  key: string;
  count: number;
  physicalSize: number;
  logicalSize: number;
  gcStatus: GcStatus;
  createdAt: number;
};

export type RealmUsage = {
  realm: string;
  physicalBytes: number;
  logicalBytes: number;
  nodeCount: number;
  quotaLimit: number;
  updatedAt: number;
};

// ============================================================================
// Depot Types
// ============================================================================

export type Depot = {
  realm: string;
  depotId: string;
  title: string;
  root: string;
  maxHistory: number;
  history: string[];
  createdAt: number;
  updatedAt: number;
};

// ============================================================================
// Commit Types
// ============================================================================

export type Commit = {
  realm: string;
  root: string;
  title?: string;
  createdAt: number;
  createdBy: string;
};

// ============================================================================
// AWP Types
// ============================================================================

export type AwpPendingAuth = {
  pubkey: string;
  clientName: string;
  verificationCode: string;
  createdAt: number;
  expiresAt: number;
};

export type AwpPubkey = {
  pubkey: string;
  userId: string;
  clientName: string;
  createdAt: number;
  expiresAt?: number;
};

// ============================================================================
// API Response Types
// ============================================================================

export type CasEndpointInfo = {
  realm: string;
  scope?: string[];
  commit?: {
    quota?: number;
    accept?: string[];
    root?: string;
  };
  expiresAt?: string;
  nodeLimit: number;
  maxNameBytes: number;
};

export type TreeNodeInfo = {
  kind: NodeKind;
  size: number;
  contentType?: string;
  children?: Record<string, string>;
  chunks?: number;
};

export type TreeResponse = {
  nodes: Record<string, TreeNodeInfo>;
  next?: string;
};

// ============================================================================
// Hono Environment
// ============================================================================

export type Env = {
  Variables: {
    auth: AuthContext;
  };
};

export type AppContext = Context<Env>;
