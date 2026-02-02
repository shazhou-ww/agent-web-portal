/**
 * Memory Storage - Shared Types
 *
 * Types used by in-memory storage implementations for local development.
 */

import type { AuthorizedPubkey, PendingAuth } from "@agent-web-portal/auth";
import type { CasOwnership, Ticket, Token, UserToken } from "../../types.ts";

// Re-export CasOwnership from types.ts
export type { CasOwnership } from "../../types.ts";

// ============================================================================
// CAS Storage Interface
// ============================================================================

export interface CasMetadata {
  casContentType?: string;
  casSize?: number;
}

export interface CasStorageEntry {
  content: Buffer;
  contentType: string;
  metadata: CasMetadata;
}

export interface CasStorageInterface {
  exists(casKey: string): Promise<boolean>;
  get(
    casKey: string
  ): Promise<{ content: Buffer; contentType: string; metadata: CasMetadata } | null>;
  put(
    content: Buffer,
    contentType?: string,
    metadata?: CasMetadata
  ): Promise<{ key: string; size: number; isNew: boolean }>;
  putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType?: string,
    metadata?: CasMetadata
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  >;
}

// ============================================================================
// DAG Types
// ============================================================================

export interface CasDagNode {
  key: string;
  children: string[];
  contentType: string;
  size: number;
  createdAt: number;
}

// ============================================================================
// Commit Types
// ============================================================================

export interface CommitRecord {
  realm: string;
  root: string;
  title?: string;
  createdAt: number;
  createdBy: string;
}

// ============================================================================
// Depot Types
// ============================================================================

export interface DepotRecord {
  realm: string;
  depotId: string;
  name: string;
  root: string;
  version: number;
  createdAt: number;
  updatedAt: number;
  description?: string;
}

export interface DepotHistoryRecord {
  realm: string;
  depotId: string;
  version: number;
  root: string;
  createdAt: number;
  message?: string;
}

// ============================================================================
// Agent Token Types
// ============================================================================

export interface AgentTokenRecord {
  id: string;
  userId: string;
  name: string;
  description?: string;
  createdAt: number;
  expiresAt: number;
}

// ============================================================================
// Database Interfaces (for dependency injection)
// ============================================================================

/**
 * TokensDb interface - abstracts token storage
 */
export interface ITokensDb {
  getToken(tokenId: string): Promise<Token | null>;
  createUserToken(userId: string, refreshToken: string, expiresIn?: number): Promise<UserToken>;
  createTicket(
    realm: string,
    issuerId: string,
    scope?: string | string[],
    commit?: boolean | { quota?: number; accept?: string[] },
    expiresIn?: number
  ): Promise<Ticket>;
  deleteToken(tokenId: string): Promise<void>;
  verifyTokenOwnership(tokenId: string, userId: string): Promise<boolean>;
}

/**
 * Options for listing ownership records
 */
export interface ListOwnershipOptions {
  limit?: number;
  startKey?: string;
}

/**
 * OwnershipDb interface - abstracts ownership storage
 */
export interface IOwnershipDb {
  hasOwnership(realm: string, casKey: string): Promise<boolean>;
  getOwnership(realm: string, casKey: string): Promise<CasOwnership | null>;
  checkOwnership(realm: string, keys: string[]): Promise<{ found: string[]; missing: string[] }>;
  addOwnership(
    realm: string,
    casKey: string,
    createdBy: string,
    contentType: string,
    size: number
  ): Promise<CasOwnership>;
  listNodes(
    realm: string,
    options?: ListOwnershipOptions
  ): Promise<{ nodes: CasOwnership[]; nextKey?: string; total: number }>;
  deleteOwnership(realm: string, casKey: string): Promise<boolean>;
}

/**
 * DagDb interface - abstracts DAG storage
 */
export interface IDagDb {
  getNode(key: string): Promise<CasDagNode | null>;
  putNode(key: string, children: string[], contentType: string, size: number): Promise<CasDagNode>;
  collectDagKeys(rootKey: string): Promise<string[]>;
}

/**
 * CommitsDb interface - abstracts commit storage
 */
export interface ICommitsDb {
  create(realm: string, root: string, createdBy: string, title?: string): Promise<CommitRecord>;
  get(realm: string, root: string): Promise<CommitRecord | null>;
  list(
    realm: string,
    options?: { limit?: number }
  ): Promise<{ commits: CommitRecord[]; nextKey?: string }>;
  listByScan(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ commits: CommitRecord[]; nextKey?: string }>;
  updateTitle(realm: string, root: string, title?: string): Promise<boolean>;
  delete(realm: string, root: string): Promise<boolean>;
}

/**
 * DepotDb interface - abstracts depot storage
 */
export interface IDepotDb {
  create(
    realm: string,
    options: { name: string; root?: string; description?: string }
  ): Promise<DepotRecord>;
  get(realm: string, depotId: string): Promise<DepotRecord | null>;
  getByName(realm: string, name: string): Promise<DepotRecord | null>;
  list(
    realm: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ depots: DepotRecord[]; nextKey?: string }>;
  updateRoot(
    realm: string,
    depotId: string,
    newRoot: string,
    message?: string
  ): Promise<{ depot: DepotRecord; history: DepotHistoryRecord }>;
  delete(realm: string, depotId: string): Promise<DepotRecord | null | boolean>;
  listHistory(
    realm: string,
    depotId: string,
    options?: { limit?: number; startKey?: string }
  ): Promise<{ history: DepotHistoryRecord[]; nextKey?: string }>;
  getHistory(realm: string, depotId: string, version: number): Promise<DepotHistoryRecord | null>;
  ensureMainDepot(realm: string, emptyCollectionKey: string): Promise<DepotRecord>;
}

/**
 * AgentTokensDb interface - abstracts agent token storage
 */
export interface IAgentTokensDb {
  create(
    userId: string,
    name: string,
    options?: { description?: string; expiresIn?: number }
  ): Promise<AgentTokenRecord>;
  listByUser(userId: string): Promise<AgentTokenRecord[]>;
  revoke(userId: string, tokenId: string): Promise<boolean>;
}

/**
 * PendingAuthStore interface - abstracts AWP pending auth storage
 */
export interface IPendingAuthStore {
  create(auth: PendingAuth): Promise<void>;
  get(pubkey: string): Promise<PendingAuth | null>;
  delete(pubkey: string): Promise<void>;
  validateCode(pubkey: string, code: string): Promise<boolean>;
}

/**
 * PubkeyStore interface - abstracts AWP pubkey storage
 */
export interface IPubkeyStore {
  lookup(pubkey: string): Promise<AuthorizedPubkey | null>;
  store(auth: AuthorizedPubkey): Promise<void>;
  revoke(pubkey: string): Promise<void>;
  listByUser(userId: string): Promise<AuthorizedPubkey[]>;
}
