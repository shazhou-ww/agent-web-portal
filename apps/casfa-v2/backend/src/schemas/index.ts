/**
 * Zod schemas exports
 *
 * Re-exports from @agent-web-portal/casfa-protocol for shared API contract,
 * plus local legacy schemas for backward compatibility.
 */

// ============================================================================
// Re-export all from casfa-protocol
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
  // Admin schemas
  UpdateUserRoleSchema,
  // Auth schemas
  AwpAuthCompleteSchema,
  AwpAuthInitSchema,
  CreateAgentTokenSchema,
  CreateTicketSchema,
  LoginSchema,
  RefreshSchema,
  TokenExchangeSchema,
  WritableConfigSchema,
  // Ticket schemas
  ListTicketsQuerySchema,
  TicketCommitSchema,
  // Depot schemas
  CreateDepotSchema,
  DEFAULT_MAX_HISTORY,
  DepotCommitSchema,
  ListDepotsQuerySchema,
  MAX_HISTORY_LIMIT,
  MAX_TITLE_LENGTH,
  UpdateDepotSchema,
  // Node schemas
  DictNodeMetadataSchema,
  FileNodeMetadataSchema,
  NodeMetadataSchema,
  NodeUploadResponseSchema,
  PrepareNodesResponseSchema,
  PrepareNodesSchema,
  SuccessorNodeMetadataSchema,
} from "@agent-web-portal/casfa-protocol";

export type {
  // Common types
  NodeKind,
  PaginationQuery,
  TicketStatus,
  UserRole,
  // Admin types
  UpdateUserRole,
  // Auth types
  AwpAuthComplete,
  AwpAuthInit,
  CreateAgentToken,
  CreateTicket,
  Login,
  Refresh,
  TokenExchange,
  WritableConfig,
  // Ticket types
  ListTicketsQuery,
  TicketCommit,
  // Depot types
  CreateDepot,
  DepotCommit,
  ListDepotsQuery,
  UpdateDepot,
  // Node types
  DictNodeMetadata,
  FileNodeMetadata,
  NodeMetadata,
  NodeUploadResponse,
  PrepareNodes,
  PrepareNodesResponse,
  SuccessorNodeMetadata,
} from "@agent-web-portal/casfa-protocol";

// ============================================================================
// Legacy schemas (for backward compatibility)
// ============================================================================

import { UpdateUserRoleSchema } from "@agent-web-portal/casfa-protocol";

/**
 * @deprecated Use UpdateUserRoleSchema instead
 */
export const AuthorizeUserSchema = UpdateUserRoleSchema;

// Legacy commit schemas
export { CommitSchema, UpdateCommitSchema } from "./commit.ts";
