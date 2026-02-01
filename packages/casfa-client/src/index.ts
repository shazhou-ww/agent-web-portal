/**
 * @aspect/casfa-client
 *
 * CASFA client library for accessing CAS storage service
 *
 * Main exports:
 * - CasfaEndpoint: Single realm CAS operations (read/write/commit)
 * - CasfaClient: Full service client (endpoints, tickets, user management)
 */

// Endpoint
export { CasfaEndpoint } from "./endpoint.ts";

// Client
export { CasfaClient } from "./client.ts";

// Types
export type {
  // Endpoint types
  CasfaEndpointConfig,
  EndpointAuth,
  EndpointInfo,
  // Client types
  CasfaClientConfig,
  ClientAuth,
  // Ticket types
  CreateTicketOptions,
  TicketInfo,
  // User types
  UserProfile,
  UsageInfo,
  QuotaConfig,
  UserInfo,
  // CAS types
  TreeNodeInfo,
  TreeResponse,
  CollectionEntry,
  WriteResult,
  CasBlobRef,
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
