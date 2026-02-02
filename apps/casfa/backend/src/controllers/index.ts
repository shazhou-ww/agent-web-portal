/**
 * Controllers - Index
 *
 * Re-exports all controllers and shared types.
 */

export type { HttpResponse } from "./adapter.ts";
// Adapter for converting between router/server and controller types
export { toBunResponse, toControllerAuth, toHttpResponse } from "./adapter.ts";
export type {
  AuthorizeUserRequest,
  AuthorizeUserResponse,
  ListUsersResponse,
  RevokeUserResponse,
  UserInfo,
} from "./admin.controller.ts";
// Admin Controller
export { AdminController } from "./admin.controller.ts";
export type {
  AgentTokenInfo,
  AwpClientCompleteRequest,
  AwpClientCompleteResponse,
  AwpClientInfo,
  AwpClientInitRequest,
  AwpClientInitResponse,
  AwpClientStatusResponse,
  CreateAgentTokenRequest,
  CreateTicketRequest,
  CreateTicketResponse,
  ListAgentTokensResponse,
  ListAwpClientsResponse,
} from "./auth.controller.ts";
// Auth Controller
export { AuthController } from "./auth.controller.ts";
export type {
  CommitInfo,
  ListCommitsRequest,
  ListCommitsResponse,
  UpdateCommitRequest,
} from "./commits.controller.ts";
// Commits Controller
export { CommitsController } from "./commits.controller.ts";
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
// Depot Controller
export { DepotController } from "./depot.controller.ts";
export type {
  LoginRequest,
  MeResponse,
  OAuthConfigResponse,
  RefreshRequest,
  TokenExchangeRequest,
} from "./oauth.controller.ts";
// OAuth Controller
export { OAuthController } from "./oauth.controller.ts";
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
  createEmptyCollectionBytes,
  EMPTY_COLLECTION_DATA,
  EMPTY_COLLECTION_KEY,
  err,
  ok,
} from "./types.ts";
