/**
 * CASFA v2 - Type Definitions
 *
 * All types use `type` instead of `interface` for consistency.
 */

import type { Context } from "hono"

// ============================================================================
// CAS Content Types and Metadata Keys
// ============================================================================

export const CAS_CONTENT_TYPES = {
  CHUNK: "application/octet-stream",
  INLINE_FILE: "application/vnd.cas.inline-file",
  FILE: "application/vnd.cas.file",
  COLLECTION: "application/vnd.cas.collection",
} as const

export type CasContentType = (typeof CAS_CONTENT_TYPES)[keyof typeof CAS_CONTENT_TYPES]

export const CAS_HEADERS = {
  CONTENT_TYPE: "X-CAS-Content-Type",
  SIZE: "X-CAS-Size",
  KIND: "X-CAS-Kind",
} as const

// ============================================================================
// Token Types
// ============================================================================

export type TokenType = "user" | "agent" | "ticket"

export type BaseToken = {
  pk: string
  type: TokenType
  createdAt: number
  expiresAt: number
}

export type UserToken = BaseToken & {
  type: "user"
  userId: string
  refreshToken?: string
}

export type AgentToken = BaseToken & {
  type: "agent"
  userId: string
  name: string
  description?: string
}

export type CommitConfig = {
  quota?: number
  accept?: string[]
  root?: string
}

export type Ticket = BaseToken & {
  type: "ticket"
  realm: string
  issuerId: string
  scope?: string[]
  commit?: CommitConfig
  config: {
    nodeLimit: number
    maxNameBytes: number
  }
}

export type Token = UserToken | AgentToken | Ticket

// ============================================================================
// User Role
// ============================================================================

export type UserRole = "unauthorized" | "authorized" | "admin"

// ============================================================================
// Auth Context
// ============================================================================

export type AuthContext = {
  token: Token
  userId: string
  realm: string
  canRead: boolean
  canWrite: boolean
  canIssueTicket: boolean
  role?: UserRole
  canManageUsers?: boolean
  allowedScope?: string[]
}

// ============================================================================
// CAS Types
// ============================================================================

// NodeKind matches cas-core: "chunk" for data, "dict" for collections
export type NodeKind = "chunk" | "dict"

export type GcStatus = "active" | "pending"

export type CasOwnership = {
  realm: string
  key: string
  kind?: NodeKind
  createdAt: number
  createdBy: string
  contentType?: string
  size: number
}

export type RefCount = {
  realm: string
  key: string
  count: number
  physicalSize: number
  logicalSize: number
  gcStatus: GcStatus
  createdAt: number
}

export type RealmUsage = {
  realm: string
  physicalBytes: number
  logicalBytes: number
  nodeCount: number
  quotaLimit: number
  updatedAt: number
}

// ============================================================================
// Depot Types
// ============================================================================

export type Depot = {
  realm: string
  depotId: string
  name: string
  root: string
  version: number
  createdAt: number
  updatedAt: number
  description?: string
}

export type DepotHistory = {
  realm: string
  depotId: string
  version: number
  root: string
  createdAt: number
  message?: string
}

// ============================================================================
// Commit Types
// ============================================================================

export type Commit = {
  realm: string
  root: string
  title?: string
  createdAt: number
  createdBy: string
}

// ============================================================================
// AWP Types
// ============================================================================

export type AwpPendingAuth = {
  pubkey: string
  clientName: string
  verificationCode: string
  createdAt: number
  expiresAt: number
}

export type AwpPubkey = {
  pubkey: string
  userId: string
  clientName: string
  createdAt: number
  expiresAt?: number
}

// ============================================================================
// API Response Types
// ============================================================================

export type CasEndpointInfo = {
  realm: string
  scope?: string[]
  commit?: {
    quota?: number
    accept?: string[]
    root?: string
  }
  expiresAt?: string
  nodeLimit: number
  maxNameBytes: number
}

export type TreeNodeInfo = {
  kind: NodeKind
  size: number
  contentType?: string
  children?: Record<string, string>
  chunks?: number
}

export type TreeResponse = {
  nodes: Record<string, TreeNodeInfo>
  next?: string
}

// ============================================================================
// Hono Environment
// ============================================================================

export type Env = {
  Variables: {
    auth: AuthContext
  }
}

export type AppContext = Context<Env>
