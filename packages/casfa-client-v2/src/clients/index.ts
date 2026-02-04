/**
 * Client exports.
 *
 * New stateless, type-safe client architecture.
 */

// Main entry point
export { createCasfaClient } from "./anonymous.ts";

// Individual client factories (for advanced usage)
export { createTicketClient, type TicketClientConfig } from "./ticket.ts";
export { createDelegateClient, type DelegateClientConfig } from "./delegate.ts";
export { createUserClient, type UserClientConfig } from "./user.ts";

// Types
export type {
  // Config
  ClientConfig,
  // Base client
  CasfaBaseClient,
  // Anonymous client (entry point)
  CasfaAnonymousClient,
  // Ticket client
  CasfaTicketClient,
  // Delegate client (for agents)
  CasfaDelegateClient,
  CasfaDelegateRealmView,
  // User client
  CasfaUserClient,
  CasfaUserRealmView,
  // API parameter types
  BuildAuthUrlParams,
  CallMcpParams,
  CallToolParams,
  CommitDepotParams,
  CommitTicketParams,
  CompleteClientParams,
  CreateAgentTokenParams,
  CreateDepotParams,
  CreateTicketParams,
  ExchangeCodeParams,
  GetDepotParams,
  InitClientParams,
  ListAgentTokensParams,
  ListClientsParams,
  ListDepotsParams,
  ListTicketsParams,
  ListUsersParams,
  LoginParams,
  PollClientParams,
  PrepareNodesParams,
  PutNodeParams,
  RefreshParams,
  RevokeAgentTokenParams,
  RevokeClientParams,
  UpdateDepotParams,
  UpdateUserRoleParams,
} from "./types.ts";

// Fetcher (for advanced usage)
export {
  createStatelessFetcher,
  type FetchResult,
  type RequestOptions,
  type StatelessFetcher,
  type StatelessFetcherConfig,
} from "./fetcher.ts";
