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

// Re-export useful types from cas-core
export type {
  CasNode,
  HashProvider,
  MemoryStorage,
  NodeKind,
  StorageProvider,
} from "@agent-web-portal/cas-core";
// Re-export useful utilities from cas-core
export { createMemoryStorage, createWebCryptoHash, decodeNode } from "@agent-web-portal/cas-core";
// Re-export node key utilities from casfa-protocol
export { hashToNodeKey, nodeKeyToHash } from "@agent-web-portal/casfa-protocol";

// Client (full user features)
export { CasfaClient } from "./client.ts";
// Endpoint
export { CasfaEndpoint } from "./endpoint.ts";
// Session (base authentication layer)
export { CasfaSession } from "./session.ts";

// Types
export type {
  AgentTokenInfo,
  CasBlobRef,
  // Client types
  CasfaClientConfig,
  // Endpoint types
  CasfaEndpointConfig,
  // Session types
  CasfaSessionConfig,
  ClientInfo,
  // Agent Token types
  CreateAgentTokenOptions,
  // OAuth Client types
  CreateClientOptions,
  CreateDepotOptions,
  // Ticket types
  CreateTicketOptions,
  DepotHistoryEntry,
  // Depot types
  DepotInfo,
  DictEntry,
  EndpointAuth,
  EndpointInfo,
  ListHistoryOptions,
  P256SignFn,
  PaginatedResult,
  QuotaConfig,
  SessionAuth,
  TicketInfo,
  // CAS types
  TreeNodeInfo,
  TreeResponse,
  UpdateClientOptions,
  UpdateDepotOptions,
  UsageInfo,
  UserInfo,
  // User types
  UserProfile,
  WriteResult,
} from "./types.ts";
export type { FileInfo, WriteFileOptions } from "./vfs.ts";
// VirtualFS (dict editing)
export { VirtualFS } from "./vfs.ts";
