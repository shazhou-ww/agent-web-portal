/**
 * 401 Challenge Response Builder
 *
 * Builds the 401 Unauthorized response with proper WWW-Authenticate headers
 * and a JSON body describing all supported authentication schemes.
 */

import {
  buildAPIKeySchemeInfo,
  buildAPIKeyWwwAuthenticate,
  buildHMACSchemeInfo,
  buildHMACWwwAuthenticate,
  buildOAuthSchemeInfo,
  buildOAuthWwwAuthenticate,
} from "./schemes/index.ts";
import type { AuthConfig, ChallengeBody, SchemeInfo } from "./types.ts";

/**
 * Options for building a challenge response
 */
export interface ChallengeOptions {
  /** Base URL of the server (for OAuth resource_metadata URL) */
  baseUrl: string;
  /** Auth configuration */
  config: AuthConfig;
  /** Custom error description */
  errorDescription?: string;
}

/**
 * Build the 401 Unauthorized challenge response
 */
export function buildChallengeResponse(options: ChallengeOptions): Response {
  const { baseUrl, config, errorDescription = "Authentication required" } = options;

  const wwwAuthenticateValues: string[] = [];
  const schemeInfos: SchemeInfo[] = [];

  // Build WWW-Authenticate headers and scheme info for each configured scheme
  for (const scheme of config.schemes) {
    switch (scheme.type) {
      case "oauth2": {
        wwwAuthenticateValues.push(buildOAuthWwwAuthenticate(scheme, baseUrl));
        schemeInfos.push(buildOAuthSchemeInfo(baseUrl));
        break;
      }
      case "hmac": {
        wwwAuthenticateValues.push(buildHMACWwwAuthenticate(scheme));
        schemeInfos.push(buildHMACSchemeInfo(scheme));
        break;
      }
      case "api_key": {
        wwwAuthenticateValues.push(buildAPIKeyWwwAuthenticate(scheme));
        schemeInfos.push(buildAPIKeySchemeInfo(scheme));
        break;
      }
    }
  }

  // Build response body
  const body: ChallengeBody = {
    error: "unauthorized",
    error_description: errorDescription,
    supported_schemes: schemeInfos,
  };

  // Build headers
  const headers = new Headers({
    "Content-Type": "application/json",
  });

  // Add multiple WWW-Authenticate headers
  for (const value of wwwAuthenticateValues) {
    headers.append("WWW-Authenticate", value);
  }

  return new Response(JSON.stringify(body), {
    status: 401,
    headers,
  });
}

/**
 * Extract base URL from request
 */
export function getBaseUrl(request: {
  url: string;
  headers: Headers | Record<string, string>;
}): string {
  const url = new URL(request.url);

  // Check for X-Forwarded-* headers (common in proxied environments)
  const headers = request.headers;
  const forwardedProto =
    headers instanceof Headers ? headers.get("x-forwarded-proto") : headers["x-forwarded-proto"];
  const forwardedHost =
    headers instanceof Headers ? headers.get("x-forwarded-host") : headers["x-forwarded-host"];

  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  return url.origin;
}
