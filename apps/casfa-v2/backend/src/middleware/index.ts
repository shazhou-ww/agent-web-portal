/**
 * Middleware exports
 */

export {
  createAuthMiddleware,
  createOptionalAuthMiddleware,
  type AuthMiddlewareDeps,
} from "./auth.ts"

export {
  createRealmAccessMiddleware,
  createWriteAccessMiddleware,
  createAdminAccessMiddleware,
} from "./realm-access.ts"

export {
  createTicketAuthMiddleware,
  checkTicketReadAccess,
  checkTicketWriteQuota,
  type TicketAuthDeps,
} from "./ticket-auth.ts"
