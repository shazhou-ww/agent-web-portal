/**
 * @agent-web-portal/auth
 *
 * AWP Authentication package for server-side auth handling.
 * Uses ECDSA P-256 keypair-based authentication with server-generated
 * verification codes for anti-phishing protection.
 *
 * @example
 * ```typescript
 * import {
 *   createAwpAuthMiddleware,
 *   routeAuthRequest,
 *   MemoryPendingAuthStore,
 *   MemoryPubkeyStore,
 * } from "@agent-web-portal/auth";
 *
 * // Create stores (use DynamoDB/Redis in production)
 * const pendingAuthStore = new MemoryPendingAuthStore();
 * const pubkeyStore = new MemoryPubkeyStore();
 *
 * // Create middleware
 * const authMiddleware = createAwpAuthMiddleware({
 *   pendingAuthStore,
 *   pubkeyStore,
 * });
 *
 * // In your request handler:
 * Bun.serve({
 *   fetch: async (req) => {
 *     // Handle auth endpoints
 *     const authResponse = await routeAuthRequest(req, {
 *       baseUrl: "https://example.com",
 *       pendingAuthStore,
 *       pubkeyStore,
 *     });
 *     if (authResponse) return authResponse;
 *
 *     // Check authentication
 *     const result = await authMiddleware(req);
 *     if (!result.authorized) {
 *       return result.challengeResponse!;
 *     }
 *
 *     // Proceed with authenticated request
 *     // result.context contains { userId, pubkey, clientName }
 *   },
 * });
 * ```
 */

// ============================================================================
// Middleware
// ============================================================================

export {
  createAwpAuthMiddleware,
  hasAwpAuthCredentials,
  routeAuthRequest,
  type AuthRouterOptions,
  type AwpAuthMiddleware,
} from "./middleware.ts";

// ============================================================================
// Auth Init (for custom implementations)
// ============================================================================

export {
  generateVerificationCode,
  handleAuthInit,
  handleAuthStatus,
  MemoryPendingAuthStore,
  type HandleAuthInitOptions,
  type HandleAuthStatusOptions,
} from "./auth-init.ts";

// ============================================================================
// Auth Complete (for custom implementations)
// ============================================================================

export {
  completeAuthorization,
  handleAuthComplete,
  MemoryPubkeyStore,
  type AuthCompleteResult,
  type HandleAuthCompleteOptions,
} from "./auth-complete.ts";

// ============================================================================
// AWP Auth (low-level utilities)
// ============================================================================

export {
  buildChallengeResponse,
  validateTimestamp,
  verifyAwpAuth,
  verifySignature,
} from "./awp-auth.ts";

// ============================================================================
// Types
// ============================================================================

export type {
  // Config
  AwpAuthConfig,
  // Stores
  PendingAuth,
  PendingAuthStore,
  AuthorizedPubkey,
  PubkeyStore,
  // Auth context and result
  AuthContext,
  AuthResult,
  // HTTP
  AuthHttpRequest,
  // Request/Response types
  AuthInitRequest,
  AuthInitResponse,
  AuthCompleteRequest,
  AuthStatusResponse,
  ChallengeBody,
} from "./types.ts";

// Constants
export { AWP_AUTH_DEFAULTS, AWP_AUTH_HEADERS } from "./types.ts";
