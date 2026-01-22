/**
 * Auth Middleware Factory
 *
 * Creates authentication middleware that can be used with various transport layers.
 */

import { buildChallengeResponse, getBaseUrl } from "./challenge.ts";
import { validateAPIKey, validateHMAC, validateOAuth } from "./schemes/index.ts";
import type { AuthConfig, AuthHttpRequest, AuthResult } from "./types.ts";
import { WELL_KNOWN_PATHS } from "./well-known.ts";

/**
 * Default paths to exclude from authentication
 */
const DEFAULT_EXCLUDE_PATHS = [
  WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE,
  "/health",
  "/healthz",
  "/ping",
];

/**
 * Check if a path should be excluded from authentication
 */
function shouldExcludePath(path: string, excludePaths: string[]): boolean {
  return excludePaths.some((excludePath) => {
    // Exact match
    if (path === excludePath) {
      return true;
    }
    // Prefix match with trailing slash (e.g., "/.well-known/" matches "/.well-known/anything")
    if (excludePath.endsWith("/") && path.startsWith(excludePath)) {
      return true;
    }
    return false;
  });
}

/**
 * Auth middleware function type
 */
export type AuthMiddleware = (request: AuthHttpRequest) => Promise<AuthResult>;

/**
 * Create authentication middleware
 *
 * @param config - Auth configuration with schemes and options
 * @returns Middleware function that validates requests
 *
 * @example
 * ```typescript
 * const authMiddleware = createAuthMiddleware({
 *   schemes: [
 *     {
 *       type: "oauth2",
 *       resourceMetadata: { ... },
 *       validateToken: async (token) => ({ valid: true, claims: {} }),
 *     },
 *     {
 *       type: "api_key",
 *       validateKey: async (key) => ({ valid: key === "secret" }),
 *     },
 *   ],
 * });
 *
 * // In your request handler:
 * const result = await authMiddleware(request);
 * if (!result.authorized) {
 *   return result.challengeResponse;
 * }
 * // Proceed with authenticated request
 * ```
 */
export function createAuthMiddleware(config: AuthConfig): AuthMiddleware {
  // Merge default and custom exclude paths
  const excludePaths = [...DEFAULT_EXCLUDE_PATHS, ...(config.excludePaths ?? [])];

  return async (request: AuthHttpRequest): Promise<AuthResult> => {
    // Extract path from URL
    const url = new URL(request.url);
    const path = url.pathname;

    // Check if path should be excluded from authentication
    if (shouldExcludePath(path, excludePaths)) {
      return {
        authorized: true,
        context: undefined,
      };
    }

    // Try each scheme in order until one succeeds
    for (const scheme of config.schemes) {
      let result:
        | { valid: true; context: import("./types.ts").AuthContext }
        | { valid: false; error?: string };

      switch (scheme.type) {
        case "oauth2":
          result = await validateOAuth(request, scheme);
          break;
        case "hmac":
          result = await validateHMAC(request, scheme);
          break;
        case "api_key":
          result = await validateAPIKey(request, scheme);
          break;
      }

      if (result.valid) {
        return {
          authorized: true,
          context: result.context,
        };
      }
    }

    // No scheme succeeded - return challenge response
    const baseUrl = getBaseUrl(request);
    const challengeResponse = buildChallengeResponse({
      baseUrl,
      config,
    });

    return {
      authorized: false,
      challengeResponse,
    };
  };
}

/**
 * Utility to check if any auth credentials are present in the request
 *
 * Useful for determining whether to return 401 (missing credentials)
 * vs 403 (invalid credentials).
 */
export function hasAuthCredentials(request: AuthHttpRequest, config: AuthConfig): boolean {
  const headers = request.headers;

  for (const scheme of config.schemes) {
    switch (scheme.type) {
      case "oauth2": {
        const authHeader =
          headers instanceof Headers ? headers.get("authorization") : headers.authorization;
        if (authHeader?.toLowerCase().startsWith("bearer ")) {
          return true;
        }
        break;
      }
      case "hmac": {
        const signatureHeader = scheme.signatureHeader ?? "X-AWP-Signature";
        const sig =
          headers instanceof Headers ? headers.get(signatureHeader) : headers[signatureHeader];
        if (sig) {
          return true;
        }
        break;
      }
      case "api_key": {
        const keyHeader = scheme.header ?? "X-API-Key";
        const key = headers instanceof Headers ? headers.get(keyHeader) : headers[keyHeader];
        if (key) {
          return true;
        }
        break;
      }
    }
  }

  return false;
}
