/**
 * Middleware exports
 */

export {
  type AuthMiddlewareDeps,
  createAuthMiddleware,
  createOptionalAuthMiddleware,
} from "./auth.ts";

export {
  createAdminAccessMiddleware,
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
} from "./realm-access.ts";

export {
  checkTicketReadAccess,
  checkTicketWriteQuota,
  createTicketAuthMiddleware,
  type TicketAuthDeps,
} from "./ticket-auth.ts";
