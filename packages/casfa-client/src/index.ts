/**
 * @agent-web-portal/casfa-client
 *
 * CASFA client library for accessing CAS storage service
 *
 * Main exports:
 * - CasfaEndpoint: Single realm CAS operations (read/write/commit)
 * - CasfaSession: Base authentication session (user/agent/p256 auth)
 * - CasfaClient: Full user client (extends Session with profile, tokens, clients, admin)
 */

// Endpoint
export { CasfaEndpoint } from "./endpoint.ts";

// Session (base authentication layer)
export { CasfaSession } from "./session.ts";

// Client (full user features)
export { CasfaClient } from "./client.ts";

// VirtualFS (collection editing)
export { VirtualFS } from "./vfs.ts";
export type { FileInfo, WriteFileOptions } from "./vfs.ts";

// Types
export type {
  // Endpoint types
  CasfaEndpointConfig,
  EndpointAuth,
  EndpointInfo,
  // Session types
  CasfaSessionConfig,
  SessionAuth,
  P256SignFn,
  // Client types
  CasfaClientConfig,
  // Ticket types
  CreateTicketOptions,
  TicketInfo,
  // User types
  UserProfile,
  UsageInfo,
  QuotaConfig,
  UserInfo,
  // Agent Token types
  CreateAgentTokenOptions,
  AgentTokenInfo,
  // OAuth Client types
  CreateClientOptions,
  UpdateClientOptions,
  ClientInfo,
  // CAS types
  TreeNodeInfo,
  TreeResponse,
  CollectionEntry,
  WriteResult,
  CasBlobRef,
  // Depot types
  DepotInfo,
  CreateDepotOptions,
  UpdateDepotOptions,
  DepotHistoryEntry,
  ListHistoryOptions,
  PaginatedResult,
} from "./types.ts";

// Re-export useful types from cas-core
export type {
  StorageProvider,
  HashProvider,
  CasNode,
  NodeKind,
} from "@agent-web-portal/cas-core";

// Re-export useful utilities from cas-core
export {
  MemoryStorageProvider,
  WebCryptoHashProvider,
  hashToKey,
  keyToHash,
  decodeNode,
} from "@agent-web-portal/cas-core";
