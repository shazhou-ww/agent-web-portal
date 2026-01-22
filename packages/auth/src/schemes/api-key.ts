/**
 * API Key Authentication Scheme
 *
 * Implements simple API key authentication via HTTP header.
 */

import type { APIKeyScheme, APIKeySchemeInfo, AuthContext, AuthHttpRequest } from "../types.ts";

/**
 * Default configuration for API Key scheme
 */
export const API_KEY_DEFAULTS = {
  realm: "mcp",
  header: "X-API-Key",
} as const;

/**
 * Get header value from request (handles both Headers and plain object)
 */
function getHeader(headers: Headers | Record<string, string>, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  // Case-insensitive lookup for plain object
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return null;
}

/**
 * Validate request using API Key scheme
 */
export async function validateAPIKey(
  request: AuthHttpRequest,
  scheme: APIKeyScheme
): Promise<{ valid: true; context: AuthContext } | { valid: false; error?: string }> {
  const headerName = scheme.header ?? API_KEY_DEFAULTS.header;
  const apiKey = getHeader(request.headers, headerName);

  if (!apiKey) {
    return { valid: false, error: `Missing ${headerName} header` };
  }

  const result = await scheme.validateKey(apiKey);

  if (!result.valid) {
    return { valid: false, error: result.error ?? "Invalid API key" };
  }

  return {
    valid: true,
    context: {
      scheme: "api_key",
      metadata: result.metadata,
    },
  };
}

/**
 * Build WWW-Authenticate header value for API Key
 */
export function buildAPIKeyWwwAuthenticate(scheme: APIKeyScheme): string {
  const realm = scheme.realm ?? API_KEY_DEFAULTS.realm;
  return `X-API-Key realm="${realm}"`;
}

/**
 * Build scheme info for challenge response body
 */
export function buildAPIKeySchemeInfo(scheme: APIKeyScheme): APIKeySchemeInfo {
  return {
    scheme: "api_key",
    header: scheme.header ?? API_KEY_DEFAULTS.header,
  };
}
