/**
 * CAS Stack - Type Definitions
 */

// ============================================================================
// Token Types
// ============================================================================

export type TokenType = "user" | "agent" | "ticket";

export interface BaseToken {
  pk: string; // token#{id}
  type: TokenType;
  createdAt: number;
  expiresAt: number;
}

export interface UserToken extends BaseToken {
  type: "user";
  userId: string;
  refreshToken?: string;
}

/**
 * Agent Token - long-lived token for AI agents
 * Inherits all permissions from the creating user
 */
export interface AgentToken extends BaseToken {
  type: "agent";
  userId: string; // owner user ID
  name: string; // human-readable name
  description?: string;
}

/**
 * Commit configuration for tickets
 * Allows a single commit with optional constraints
 */
export interface CommitConfig {
  quota?: number; // total bytes limit
  accept?: string[]; // allowed MIME types
  root?: string; // already committed root key (if set, cannot commit again)
}

/**
 * Ticket - provides limited access to CAS resources
 */
export interface Ticket extends BaseToken {
  type: "ticket";
  realm: string; // user namespace (e.g., "usr_{userId}")
  issuerId: string; // who issued this ticket
  scope?: string[]; // readable root keys (undefined = full read access)
  commit?: CommitConfig; // commit permission (undefined = read-only)
  config: {
    nodeLimit: number; // max size for any node (chunk/file/collection)
    maxNameBytes: number; // max file name length in UTF-8 bytes
  };
}

export type Token = UserToken | AgentToken | Ticket;

export interface TokenPermissions {
  read: boolean;
  write: boolean;
  issueTicket: boolean;
}

// ============================================================================
// Auth Request/Response Types
// ============================================================================

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  userToken: string;
  refreshToken: string;
  expiresAt: string;
  user: {
    id: string;
    email: string;
    name?: string;
  };
  /** Resolved user role for UI (unauthorized / authorized / admin) */
  role?: UserRole;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  userToken: string;
  expiresAt: string;
  /** Resolved user role for UI */
  role?: UserRole;
}

// ============================================================================
// Agent Token Request/Response Types
// ============================================================================

export interface CreateAgentTokenRequest {
  name: string;
  description?: string;
  expiresIn?: number; // seconds, default 30 days (2592000)
}

export interface CreateAgentTokenResponse {
  id: string;
  name: string;
  description?: string;
  expiresAt: string;
  createdAt: string;
}

export interface AgentTokenInfo {
  id: string;
  name: string;
  description?: string;
  expiresAt: string;
  createdAt: string;
}

export interface ListAgentTokensResponse {
  tokens: AgentTokenInfo[];
}

// ============================================================================
// Ticket Request/Response Types
// ============================================================================

export interface CreateTicketRequest {
  scope?: string | string[]; // DAG root keys to allow access (optional, undefined = full read)
  commit?: boolean | { quota?: number; accept?: string[] }; // commit permission config
  expiresIn?: number; // seconds, default 3600
}

export interface CreateTicketResponse {
  id: string;
  endpoint: string; // Full endpoint URL: /api/ticket/{ticketId}
  expiresAt: string;
  realm: string;
  scope?: string[];
  commit: CommitConfig | false;
  config: {
    nodeLimit: number;
    maxNameBytes: number;
  };
}

// ============================================================================
// CAS Types
// ============================================================================

/**
 * Node kind in CAS structure
 * - chunk: raw data block
 * - inline-file: single-chunk file (content + metadata)
 * - file: multi-chunk file (index node)
 * - collection: directory structure
 */
export type NodeKind = "chunk" | "inline-file" | "file" | "collection";

/**
 * CAS Ownership - tracks which realm owns a key
 */
export interface CasOwnership {
  realm: string;
  key: string;
  kind?: NodeKind; // node type: collection, file, or chunk
  createdAt: number;
  createdBy: string;
  contentType?: string;
  size: number;
}

// ============================================================================
// Raw Node Types (Storage Layer View)
// ============================================================================

export interface CasRawCollectionNode {
  kind: "collection";
  key: string;
  size: number;
  children: Record<string, string>; // name → key
}

export interface CasRawFileNode {
  kind: "file";
  key: string;
  size: number;
  contentType: string;
  chunks: string[]; // chunk keys
}

export interface CasRawChunkNode {
  kind: "chunk";
  key: string;
  size: number;
  parts?: string[]; // sub-chunks (B-tree)
}

export type CasRawNode = CasRawCollectionNode | CasRawFileNode | CasRawChunkNode;

// ============================================================================
// Application Node Types (Application Layer View)
// ============================================================================

export interface CasCollectionNode {
  kind: "collection";
  key: string;
  size: number;
  children: Record<string, CasNode>; // recursively expanded
}

export interface CasFileNode {
  kind: "file";
  key: string;
  size: number;
  contentType: string;
  // Note: no content field! Use openFile() for streaming
}

export type CasNode = CasCollectionNode | CasFileNode;

// ============================================================================
// Legacy Types (to be removed)
// ============================================================================

/** @deprecated Use CasRawNode instead */
export interface CasDagNode {
  key: string;
  children: string[];
  contentType: string;
  size: number;
  createdAt: number;
}

export interface ResolveRequest {
  root: string;
  nodes: string[];
}

export interface ResolveResponse {
  missing: string[];
}

export interface UploadNodeResponse {
  key: string;
  size: number;
  contentType: string;
}

export interface UploadDagResponse {
  uploaded: Array<{
    key: string;
    size: number;
    contentType: string;
  }>;
  failed: Array<{
    key: string;
    error: string;
  }>;
  root: string;
}

// ============================================================================
// User Role (authorization level)
// ============================================================================

export type UserRole = "unauthorized" | "authorized" | "admin";

// ============================================================================
// Parsed Auth Context
// ============================================================================

export interface AuthContext {
  token: Token;
  userId: string;
  realm: string; // user namespace
  canRead: boolean;
  canWrite: boolean;
  canIssueTicket: boolean;
  /** Resolved user role (only set for user/agent/AWP auth) */
  role?: UserRole;
  /** True only for admin; allows user management APIs */
  canManageUsers?: boolean;
  /** For tickets, the allowed readable root keys */
  allowedScope?: string[];
}

// ============================================================================
// HTTP Types
// ============================================================================

export interface HttpRequest {
  method: string;
  path: string;
  /** Original path before any prefix stripping (for signature verification) */
  originalPath?: string;
  headers: Record<string, string | undefined>;
  query: Record<string, string | undefined>;
  pathParams: Record<string, string>;
  body: Buffer | string | null;
  isBase64Encoded?: boolean;
}

export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
  isBase64Encoded?: boolean;
}

// ============================================================================
// Config
// ============================================================================

export interface CasServerConfig {
  nodeLimit: number; // max size for any node, default 4MB
  maxNameBytes: number; // max file name length in UTF-8 bytes, default 255
  maxCollectionChildren: number; // max collection children, default 10000
  maxPayloadSize: number; // default 10MB
  maxTicketTtl: number; // max ticket TTL in seconds, default 86400 (24h)
  maxAgentTokenTtl: number; // max agent token TTL in seconds, default 2592000 (30d)
  baseUrl: string; // Base URL for constructing endpoint URLs
}

export interface CasConfig {
  tokensTable: string;
  casRealmTable: string;
  casDagTable: string;
  casBucket: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoRegion: string;
  /** Cognito Hosted UI base URL for OAuth / Google sign-in token exchange */
  cognitoHostedUiUrl: string;
  serverConfig: CasServerConfig;
}

export function loadServerConfig(): CasServerConfig {
  return {
    nodeLimit: parseInt(process.env.CAS_NODE_LIMIT ?? "4194304", 10), // 4MB
    maxNameBytes: parseInt(process.env.CAS_MAX_NAME_BYTES ?? "255", 10), // 255 bytes
    maxCollectionChildren: parseInt(process.env.CAS_MAX_COLLECTION_CHILDREN ?? "10000", 10),
    maxPayloadSize: parseInt(process.env.CAS_MAX_PAYLOAD_SIZE ?? "10485760", 10), // 10MB
    maxTicketTtl: parseInt(process.env.CAS_MAX_TICKET_TTL ?? "86400", 10), // 24 hours
    maxAgentTokenTtl: parseInt(process.env.CAS_MAX_AGENT_TOKEN_TTL ?? "2592000", 10), // 30 days
    baseUrl: process.env.CAS_BASE_URL ?? "http://localhost:3000",
  };
}

export function loadConfig(): CasConfig {
  return {
    tokensTable: process.env.TOKENS_TABLE ?? "cas-tokens",
    casRealmTable: process.env.CAS_REALM_TABLE ?? "cas-realm",
    casDagTable: process.env.CAS_DAG_TABLE ?? "cas-dag",
    casBucket: process.env.CAS_BUCKET ?? "cas-bucket",
    cognitoUserPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
    cognitoClientId: process.env.COGNITO_CLIENT_ID ?? "",
    cognitoRegion: process.env.COGNITO_REGION ?? "us-east-1",
    cognitoHostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
    serverConfig: loadServerConfig(),
  };
}

// ============================================================================
// CAS API Request/Response Types
// ============================================================================

/**
 * CasEndpointInfo - describes endpoint capabilities and configuration
 * Returned by GET /cas/{realm}
 */
export interface CasEndpointInfo {
  /** The actual realm (e.g., "usr_xxx") */
  realm: string;

  /** Readable scope: undefined=full access, string[]=only these root keys */
  scope?: string[];

  /** Commit permission: undefined=read-only, object=can commit once */
  commit?: {
    quota?: number; // bytes limit
    accept?: string[]; // allowed MIME types
    root?: string; // already committed root (if set, cannot commit again)
  };

  /** Expiration time (for tickets) */
  expiresAt?: string;

  /** Max size for any node in bytes (default 4MB) */
  nodeLimit: number;

  /** Max file name length in UTF-8 bytes (default 255) */
  maxNameBytes: number;
}

/** @deprecated Use CasEndpointInfo directly */
export interface CasConfigResponse {
  nodeLimit: number;
  maxCollectionChildren: number;
  maxPayloadSize: number;
}

export interface PutChunkResponse {
  key: string;
  size: number;
}

export interface PutFileRequest {
  chunks: string[];
  contentType: string;
}

export interface PutFileResponse {
  key: string;
}

export interface PutCollectionRequest {
  children: Record<string, string>;
}

export interface PutCollectionResponse {
  key: string;
}
