/**
 * @agent-web-portal/auth
 *
 * Authentication middleware for Agent Web Portal.
 * Supports OAuth 2.1, HMAC signature, and API Key authentication.
 *
 * @example
 * ```typescript
 * import {
 *   createAuthMiddleware,
 *   createWellKnownHandler,
 *   handleWellKnown,
 * } from "@agent-web-portal/auth";
 *
 * // Create auth middleware
 * const authMiddleware = createAuthMiddleware({
 *   schemes: [
 *     {
 *       type: "oauth2",
 *       resourceMetadata: {
 *         resource: "https://api.example.com/mcp",
 *         authorization_servers: ["https://auth.example.com"],
 *       },
 *       validateToken: async (token) => {
 *         // Validate JWT or call introspection endpoint
 *         return { valid: true, claims: { sub: "user-123" } };
 *       },
 *     },
 *     {
 *       type: "hmac",
 *       secret: process.env.HMAC_SECRET!,
 *     },
 *     {
 *       type: "api_key",
 *       validateKey: async (key) => ({ valid: key === "my-secret-key" }),
 *     },
 *   ],
 * });
 *
 * // Use in your request handler
 * const result = await authMiddleware(request);
 * if (!result.authorized) {
 *   return result.challengeResponse; // 401 with WWW-Authenticate headers
 * }
 *
 * // Handle well-known endpoints
 * const wellKnownResponse = handleWellKnown(request, config);
 * if (wellKnownResponse) {
 *   return wellKnownResponse;
 * }
 * ```
 */

// ============================================================================
// Challenge Builder
// ============================================================================
export { buildChallengeResponse, type ChallengeOptions, getBaseUrl } from "./challenge.ts";

// ============================================================================
// Middleware
// ============================================================================
export { type AuthMiddleware, createAuthMiddleware, hasAuthCredentials } from "./middleware.ts";
// ============================================================================
// Individual Scheme Utilities (for advanced use cases)
// ============================================================================
export {
  API_KEY_DEFAULTS,
  buildAPIKeySchemeInfo,
  buildAPIKeyWwwAuthenticate,
  buildHMACSchemeInfo,
  buildHMACWwwAuthenticate,
  buildOAuthSchemeInfo,
  buildOAuthWwwAuthenticate,
  // OAuth
  extractBearerToken,
  HMAC_DEFAULTS,
  OAUTH_DEFAULTS,
  // API Key
  validateAPIKey,
  // HMAC
  validateHMAC,
  validateOAuth,
} from "./schemes/index.ts";
// ============================================================================
// Types
// ============================================================================
export type {
  APIKeyScheme,
  APIKeySchemeInfo,
  // Config types
  AuthConfig,
  AuthContext,
  // HTTP types
  AuthHttpRequest,
  // Result types
  AuthResult,
  // Scheme types
  AuthScheme,
  AuthSchemeBase,
  AuthSchemeType,
  // Challenge types
  ChallengeBody,
  HMACScheme,
  HMACSchemeInfo,
  KeyValidationResult,
  OAuthScheme,
  OAuthSchemeInfo,
  ProtectedResourceMetadata,
  SchemeInfo,
  TokenValidationResult,
} from "./types.ts";
// ============================================================================
// Well-Known Handlers
// ============================================================================
export {
  createWellKnownHandler,
  handleWellKnown,
  isWellKnownPath,
  WELL_KNOWN_PATHS,
} from "./well-known.ts";
