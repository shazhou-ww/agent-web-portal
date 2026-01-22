/**
 * Well-Known Endpoint Handlers
 *
 * Handles RFC 9728 OAuth 2.0 Protected Resource Metadata endpoint.
 */

import type {
  AuthConfig,
  AuthHttpRequest,
  OAuthScheme,
  ProtectedResourceMetadata,
} from "./types.ts";

/**
 * Well-known endpoint paths
 */
export const WELL_KNOWN_PATHS = {
  OAUTH_PROTECTED_RESOURCE: "/.well-known/oauth-protected-resource",
} as const;

/**
 * Check if a path is a well-known endpoint
 */
export function isWellKnownPath(path: string): boolean {
  return path === WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE;
}

/**
 * Get OAuth scheme from config if present
 */
function getOAuthScheme(config: AuthConfig): OAuthScheme | undefined {
  return config.schemes.find((s) => s.type === "oauth2") as OAuthScheme | undefined;
}

/**
 * Handle well-known endpoint requests
 *
 * @param request - The HTTP request
 * @param config - Auth configuration
 * @returns Response if handled, null if not a well-known endpoint
 */
export function handleWellKnown(request: AuthHttpRequest, config: AuthConfig): Response | null {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE) {
    return handleProtectedResourceMetadata(request, config);
  }

  return null;
}

/**
 * Handle /.well-known/oauth-protected-resource endpoint
 *
 * Returns the Protected Resource Metadata (RFC 9728) if OAuth is configured.
 */
function handleProtectedResourceMetadata(request: AuthHttpRequest, config: AuthConfig): Response {
  const oauthScheme = getOAuthScheme(config);

  if (!oauthScheme) {
    return new Response(
      JSON.stringify({
        error: "not_found",
        error_description: "OAuth authentication is not configured for this resource",
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Build Protected Resource Metadata response
  const metadata: ProtectedResourceMetadata = {
    resource: oauthScheme.resourceMetadata.resource,
    authorization_servers: oauthScheme.resourceMetadata.authorization_servers,
  };

  // Add optional fields if present
  if (oauthScheme.resourceMetadata.scopes_supported) {
    metadata.scopes_supported = oauthScheme.resourceMetadata.scopes_supported;
  }

  if (oauthScheme.resourceMetadata.bearer_methods_supported) {
    metadata.bearer_methods_supported = oauthScheme.resourceMetadata.bearer_methods_supported;
  }

  if (oauthScheme.resourceMetadata.resource_documentation) {
    metadata.resource_documentation = oauthScheme.resourceMetadata.resource_documentation;
  }

  if (oauthScheme.resourceMetadata.resource_name) {
    metadata.resource_name = oauthScheme.resourceMetadata.resource_name;
  }

  if (oauthScheme.resourceMetadata.resource_description) {
    metadata.resource_description = oauthScheme.resourceMetadata.resource_description;
  }

  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=3600", // Cache for 1 hour
    },
  });
}

/**
 * Create a well-known handler for use with various transport layers
 */
export function createWellKnownHandler(
  config: AuthConfig
): (request: AuthHttpRequest) => Response | null {
  return (request: AuthHttpRequest) => handleWellKnown(request, config);
}
