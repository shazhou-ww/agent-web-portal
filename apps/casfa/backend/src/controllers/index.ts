/**
 * Controllers - Index
 *
 * Re-exports all controllers and shared types.
 */

// Shared types
export type {
  AuthContext,
  CasEndpointInfo,
  CognitoConfig,
  ControllerResult,
  Dependencies,
  IUserRolesDb,
  ServerConfig,
  UserRole,
  UserRoleRecord,
} from "./types.ts";

export {
  ok,
  err,
  EMPTY_COLLECTION_KEY,
  EMPTY_COLLECTION_DATA,
  createEmptyCollectionBytes,
} from "./types.ts";

// Auth Controller
export { AuthController } from "./auth.controller.ts";
export type {
  AwpClientCompleteRequest,
  AwpClientCompleteResponse,
  AwpClientInfo,
  AwpClientInitRequest,
  AwpClientInitResponse,
  AwpClientStatusResponse,
  CreateAgentTokenRequest,
  AgentTokenInfo,
  CreateTicketRequest,
  CreateTicketResponse,
  ListAgentTokensResponse,
  ListAwpClientsResponse,
} from "./auth.controller.ts";

// OAuth Controller
export { OAuthController } from "./oauth.controller.ts";
export type {
  LoginRequest,
  MeResponse,
  OAuthConfigResponse,
  RefreshRequest,
  TokenExchangeRequest,
} from "./oauth.controller.ts";

// Admin Controller
export { AdminController } from "./admin.controller.ts";
export type {
  AuthorizeUserRequest,
  AuthorizeUserResponse,
  ListUsersResponse,
  RevokeUserResponse,
  UserInfo,
} from "./admin.controller.ts";

// Depot Controller
export { DepotController } from "./depot.controller.ts";
export type {
  CreateDepotRequest,
  DepotHistoryEntry,
  DepotInfo,
  ListDepotHistoryRequest,
  ListDepotHistoryResponse,
  ListDepotsRequest,
  ListDepotsResponse,
  RollbackDepotRequest,
  UpdateDepotRequest,
} from "./depot.controller.ts";

// Commits Controller
export { CommitsController } from "./commits.controller.ts";
export type {
  CommitInfo,
  ListCommitsRequest,
  ListCommitsResponse,
  UpdateCommitRequest,
} from "./commits.controller.ts";
