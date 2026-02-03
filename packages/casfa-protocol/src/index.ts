/**
 * CASFA Protocol - Shared schemas and types for API contract
 *
 * @packageDocumentation
 */

// ============================================================================
// Common schemas and types
// ============================================================================

export {
  // ID regex patterns
  CLIENT_ID_REGEX,
  DEPOT_ID_REGEX,
  ISSUER_ID_REGEX,
  NODE_KEY_REGEX,
  TICKET_ID_REGEX,
  TOKEN_ID_REGEX,
  USER_ID_REGEX,
  // ID schemas
  ClientIdSchema,
  DepotIdSchema,
  IssuerIdSchema,
  NodeKeySchema,
  TicketIdSchema,
  TokenIdSchema,
  UserIdSchema,
  // Enum schemas
  NodeKindSchema,
  TicketStatusSchema,
  UserRoleSchema,
  // Pagination
  PaginationQuerySchema,
} from "./common.ts";

export type { NodeKind, PaginationQuery, TicketStatus, UserRole } from "./common.ts";

// ============================================================================
// Admin schemas
// ============================================================================

export { UpdateUserRoleSchema } from "./admin.ts";
export type { UpdateUserRole } from "./admin.ts";

// ============================================================================
// Auth schemas
// ============================================================================

export {
  // OAuth
  LoginSchema,
  RefreshSchema,
  TokenExchangeSchema,
  // AWP Client
  AwpAuthCompleteSchema,
  AwpAuthInitSchema,
  // Ticket
  CreateTicketSchema,
  WritableConfigSchema,
  // Agent Token
  CreateAgentTokenSchema,
} from "./auth.ts";

export type {
  AwpAuthComplete,
  AwpAuthInit,
  CreateAgentToken,
  CreateTicket,
  Login,
  Refresh,
  TokenExchange,
  WritableConfig,
} from "./auth.ts";

// ============================================================================
// Ticket schemas
// ============================================================================

export { ListTicketsQuerySchema, TicketCommitSchema } from "./ticket.ts";
export type { ListTicketsQuery, TicketCommit } from "./ticket.ts";

// ============================================================================
// Depot schemas
// ============================================================================

export {
  // Constants
  DEFAULT_MAX_HISTORY,
  MAX_HISTORY_LIMIT,
  MAX_TITLE_LENGTH,
  // Schemas
  CreateDepotSchema,
  DepotCommitSchema,
  ListDepotsQuerySchema,
  UpdateDepotSchema,
} from "./depot.ts";

export type { CreateDepot, DepotCommit, ListDepotsQuery, UpdateDepot } from "./depot.ts";

// ============================================================================
// Node schemas
// ============================================================================

export {
  // Operation schemas
  PrepareNodesResponseSchema,
  PrepareNodesSchema,
  // Metadata schemas
  DictNodeMetadataSchema,
  FileNodeMetadataSchema,
  NodeMetadataSchema,
  SuccessorNodeMetadataSchema,
  // Upload response
  NodeUploadResponseSchema,
} from "./node.ts";

export type {
  DictNodeMetadata,
  FileNodeMetadata,
  NodeMetadata,
  NodeUploadResponse,
  PrepareNodes,
  PrepareNodesResponse,
  SuccessorNodeMetadata,
} from "./node.ts";
