/**
 * casfa-client-v2 - CASFA client library with unified authorization strategies
 *
 * @packageDocumentation
 */

// =============================================================================
// Main Client
// =============================================================================

export { type CasfaClient, type CasfaClientConfig, createCasfaClient } from "./client.ts";

// =============================================================================
// Types
// =============================================================================

// API types
export type {
  // Response types
  AgentTokenInfo,
  // Re-exports from casfa-protocol
  AwpAuthComplete,
  AwpAuthInit,
  AwpAuthInitResponse,
  AwpAuthPollResponse,
  AwpClientInfo,
  CognitoConfig,
  CreateAgentToken,
  CreateAgentTokenResponse,
  CreateDepot,
  CreateTicket,
  DepotCommit,
  DepotDetail,
  DepotHistoryEntry,
  DepotInfo,
  DictNodeMetadata,
  FileNodeMetadata,
  ListDepotsQuery,
  ListTicketsQuery,
  Login,
  McpRequest,
  McpResponse,
  NodeKind,
  NodeMetadata,
  NodeUploadResponse,
  PaginatedResponse,
  PaginationQuery,
  PrepareNodes,
  PrepareNodesResponse,
  PrepareNodesResult,
  RealmInfo,
  RealmUsage,
  Refresh,
  SuccessorNodeMetadata,
  TicketCommit,
  TicketInfo,
  TicketListItem,
  TicketStatus,
  TokenExchange,
  TokenResponse,
  UpdateDepot,
  UpdateUserRole,
  UserInfo,
  UserListItem,
  UserRole,
  WritableConfig,
} from "./types/api.ts";
// Auth types
export type {
  AuthConfig,
  AuthState,
  AuthStrategy,
  AuthType,
  P256AuthCallbacks,
  P256AuthState,
  P256PollStatus,
  TicketAuthState,
  TokenAuthState,
  UserAuthCallbacks,
  UserAuthState,
} from "./types/auth.ts";
// Provider types
export type {
  HashProvider,
  KeyPairProvider,
  P256KeyPair,
  StorageProvider,
} from "./types/providers.ts";
export { createWebCryptoHashProvider } from "./types/providers.ts";

// =============================================================================
// Auth Strategies
// =============================================================================

export {
  createP256Auth,
  type P256AuthConfig,
  type P256AuthStrategy,
} from "./auth/p256.ts";
// Permissions
export {
  type ApiName,
  assertAccess,
  canAccess,
  checkPermission,
  getRequiredAuth,
  isPublicApi,
  type PermissionCheckResult,
} from "./auth/permissions.ts";
export {
  createTicketAuth,
  type TicketAuthConfig,
  type TicketAuthStrategy,
} from "./auth/ticket.ts";
export {
  createTokenAuth,
  type TokenAuthConfig,
  type TokenAuthStrategy,
} from "./auth/token.ts";
export {
  createUserAuth,
  type UserAuthConfig,
  type UserAuthStrategy,
} from "./auth/user.ts";

// =============================================================================
// Utils
// =============================================================================

export type {
  CasfaError,
  CasfaErrorCode,
} from "./utils/errors.ts";

export {
  createError,
  isCasfaError,
} from "./utils/errors.ts";

export type { FetchResult } from "./utils/fetch.ts";
