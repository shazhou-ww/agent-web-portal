/**
 * OAuth 2.1 Authentication Scheme
 *
 * Implements OAuth 2.1 Bearer token authentication with RFC 9728
 * Protected Resource Metadata support.
 */

import type { AuthContext, AuthHttpRequest, OAuthScheme, OAuthSchemeInfo } from "../types.ts";

/**
 * Default configuration for OAuth scheme
 */
export const OAUTH_DEFAULTS = {
  realm: "mcp",
  bearerMethod: "header" as const,
} as const;

/**
 * Extract Bearer token from request
 */
export function extractBearerToken(request: AuthHttpRequest): string | null {
  const headers = request.headers;
  const authHeader =
    headers instanceof Headers ? headers.get("authorization") : headers.authorization;

  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

/**
 * Validate request using OAuth scheme
 */
export async function validateOAuth(
  request: AuthHttpRequest,
  scheme: OAuthScheme
): Promise<{ valid: true; context: AuthContext } | { valid: false; error?: string }> {
  const token = extractBearerToken(request);

  if (!token) {
    return { valid: false, error: "No Bearer token provided" };
  }

  const result = await scheme.validateToken(token);

  if (!result.valid) {
    return { valid: false, error: result.error ?? "Invalid token" };
  }

  return {
    valid: true,
    context: {
      scheme: "oauth2",
      claims: result.claims,
    },
  };
}

/**
 * Build WWW-Authenticate header value for OAuth
 */
export function buildOAuthWwwAuthenticate(scheme: OAuthScheme, baseUrl: string): string {
  const realm = scheme.realm ?? OAUTH_DEFAULTS.realm;
  const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource`;

  return `Bearer realm="${realm}", resource_metadata="${resourceMetadataUrl}"`;
}

/**
 * Build scheme info for challenge response body
 */
export function buildOAuthSchemeInfo(baseUrl: string): OAuthSchemeInfo {
  return {
    scheme: "oauth2",
    resource_metadata_url: `${baseUrl}/.well-known/oauth-protected-resource`,
  };
}
