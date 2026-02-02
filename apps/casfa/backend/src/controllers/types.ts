/**
 * Controller Types
 *
 * Shared types and interfaces for the controller layer.
 */

import type {
  CasStorageInterface,
  IAgentTokensDb,
  ICommitsDb,
  IDagDb,
  IDepotDb,
  IOwnershipDb,
  IPendingAuthStore,
  IPubkeyStore,
  ITokensDb,
} from "../db/memory/types.ts";

// ============================================================================
// Server Configuration
// ============================================================================

export interface ServerConfig {
  baseUrl: string;
  nodeLimit: number;
  maxNameBytes: number;
}

// ============================================================================
// Auth Context (passed from middleware to controllers)
// ============================================================================

export interface AuthContext {
  /** User ID (empty string for tickets) */
  userId: string;
  /** Realm/namespace for CAS operations */
  realm: string;
  /** Token ID for tracking */
  tokenId: string;
  /** Can read from CAS */
  canRead: boolean;
  /** Can write to CAS */
  canWrite: boolean;
  /** Can issue tickets (user/agent tokens only) */
  canIssueTicket: boolean;
  /** Can manage users (admin only) */
  canManageUsers: boolean;
  /** User role */
  role?: "unauthorized" | "authorized" | "admin";
  /** Allowed keys for scoped access (tickets) */
  allowedKeys?: string[];
}

// ============================================================================
// Dependencies Interface (for dependency injection)
// ============================================================================

/**
 * Dependencies required by controllers.
 * Both router.ts (Lambda) and server.ts (Bun) provide implementations.
 */
export interface Dependencies {
  // Storage
  tokensDb: ITokensDb;
  ownershipDb: IOwnershipDb;
  dagDb: IDagDb;
  commitsDb: ICommitsDb;
  depotDb: IDepotDb;
  casStorage: CasStorageInterface;

  // Auth stores
  agentTokensDb: IAgentTokensDb;
  pendingAuthStore: IPendingAuthStore;
  pubkeyStore: IPubkeyStore;

  // Optional: User roles (only available with DynamoDB)
  userRolesDb?: IUserRolesDb;

  // Config
  serverConfig: ServerConfig;
  cognitoConfig?: CognitoConfig;
}

// ============================================================================
// User Roles Interface
// ============================================================================

export type UserRole = "unauthorized" | "authorized" | "admin";

export interface UserRoleRecord {
  userId: string;
  role: UserRole;
}

export interface IUserRolesDb {
  getRole(userId: string): Promise<UserRole>;
  setRole(userId: string, role: UserRole): Promise<void>;
  revoke(userId: string): Promise<void>;
  ensureUser(userId: string): Promise<void>;
  listRoles(): Promise<UserRoleRecord[]>;
}

// ============================================================================
// Cognito Configuration
// ============================================================================

export interface CognitoConfig {
  userPoolId: string;
  clientId: string;
  region: string;
  hostedUiUrl?: string;
}

// ============================================================================
// Controller Result Types
// ============================================================================

/**
 * Generic result type for controller operations
 */
export type ControllerResult<T> =
  | { success: true; data: T }
  | { success: false; error: string; status: number; details?: unknown };

/**
 * Helper to create success results
 */
export function ok<T>(data: T): ControllerResult<T> {
  return { success: true, data };
}

/**
 * Helper to create error results
 */
export function err<T>(status: number, error: string, details?: unknown): ControllerResult<T> {
  return { success: false, error, status, details };
}

// ============================================================================
// CAS Endpoint Info (returned by /realm and /ticket endpoints)
// ============================================================================

export interface CasEndpointInfo {
  realm: string;
  scope?: string[];
  commit?: { quota?: number; accept?: string[] };
  expiresAt?: string;
  nodeLimit: number;
  maxNameBytes: number;
}

// ============================================================================
// Empty Collection Constants
// ============================================================================

export const EMPTY_COLLECTION_KEY =
  "sha256:a78577c5cfc47ab3e4b116f01902a69e2e015b40cdef52f9b552cfb5104e769a";

// Empty collection is a 32-byte binary header
// Structure: magic(4) + flags(4) + count(4) + padding(4) + size(8) + namesOffset(4) + typeOffset(4)
const HEADER_SIZE = 32;
const MAGIC = 0x01534143; // "CAS\x01" in little-endian
const FLAGS_HAS_NAMES = 0x01;

export function createEmptyCollectionBytes(): Buffer {
  const bytes = Buffer.alloc(HEADER_SIZE);
  bytes.writeUInt32LE(MAGIC, 0); // magic
  bytes.writeUInt32LE(FLAGS_HAS_NAMES, 4); // flags
  bytes.writeUInt32LE(0, 8); // count = 0
  bytes.writeUInt32LE(0, 12); // padding
  bytes.writeBigUInt64LE(0n, 16); // size = 0
  bytes.writeUInt32LE(HEADER_SIZE, 24); // namesOffset = 32
  bytes.writeUInt32LE(0, 28); // typeOffset = 0
  return bytes;
}

export const EMPTY_COLLECTION_DATA = createEmptyCollectionBytes();
