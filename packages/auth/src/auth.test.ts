/**
 * Auth Package Test Suite
 *
 * Run tests with:
 *   bun test packages/auth/src/auth.test.ts
 */

import { describe, expect, test } from "bun:test";
import { buildChallengeResponse, getBaseUrl } from "./challenge.ts";
import { createAuthMiddleware, hasAuthCredentials } from "./middleware.ts";
import { validateAPIKey } from "./schemes/api-key.ts";
import { validateHMAC } from "./schemes/hmac.ts";
import { extractBearerToken, validateOAuth } from "./schemes/oauth.ts";
import type {
  APIKeyScheme,
  AuthConfig,
  AuthHttpRequest,
  HMACScheme,
  OAuthScheme,
} from "./types.ts";
import { createWellKnownHandler, handleWellKnown, WELL_KNOWN_PATHS } from "./well-known.ts";

// =============================================================================
// Helper Functions
// =============================================================================

function createMockRequest(options: {
  url?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}): AuthHttpRequest {
  const { url = "https://example.com/mcp", method = "POST", headers = {}, body = "{}" } = options;

  return {
    url,
    method,
    headers: new Headers(headers),
    text: async () => body,
    clone: () => createMockRequest(options),
  };
}

// Helper to compute HMAC signature
async function computeHmacSignature(
  secret: string,
  method: string,
  path: string,
  timestamp: string,
  body: string
): Promise<string> {
  const encoder = new TextEncoder();

  // Compute body hash
  const bodyBuffer = encoder.encode(body);
  const bodyHashBuffer = await crypto.subtle.digest("SHA-256", bodyBuffer);
  const bodyHash = Array.from(new Uint8Array(bodyHashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Build string to sign
  const stringToSign = `${method}\n${path}\n${timestamp}\n${bodyHash}`;

  // Compute HMAC
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(stringToSign));

  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// =============================================================================
// OAuth Scheme Tests
// =============================================================================

describe("OAuth Scheme", () => {
  test("extractBearerToken extracts valid token", () => {
    const request = createMockRequest({
      headers: { Authorization: "Bearer my-secret-token" },
    });
    const token = extractBearerToken(request);
    expect(token).toBe("my-secret-token");
  });

  test("extractBearerToken returns null for missing header", () => {
    const request = createMockRequest({});
    const token = extractBearerToken(request);
    expect(token).toBeNull();
  });

  test("extractBearerToken returns null for non-Bearer auth", () => {
    const request = createMockRequest({
      headers: { Authorization: "Basic dXNlcjpwYXNz" },
    });
    const token = extractBearerToken(request);
    expect(token).toBeNull();
  });

  test("extractBearerToken is case-insensitive", () => {
    const request = createMockRequest({
      headers: { Authorization: "bearer my-token" },
    });
    const token = extractBearerToken(request);
    expect(token).toBe("my-token");
  });

  test("validateOAuth succeeds with valid token", async () => {
    const request = createMockRequest({
      headers: { Authorization: "Bearer valid-token" },
    });

    const scheme: OAuthScheme = {
      type: "oauth2",
      resourceMetadata: {
        resource: "https://example.com/mcp",
        authorization_servers: ["https://auth.example.com"],
      },
      validateToken: async (token) => ({
        valid: token === "valid-token",
        claims: { sub: "user-123" },
      }),
    };

    const result = await validateOAuth(request, scheme);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.context.scheme).toBe("oauth2");
      expect(result.context.claims?.sub).toBe("user-123");
    }
  });

  test("validateOAuth fails with invalid token", async () => {
    const request = createMockRequest({
      headers: { Authorization: "Bearer invalid-token" },
    });

    const scheme: OAuthScheme = {
      type: "oauth2",
      resourceMetadata: {
        resource: "https://example.com/mcp",
        authorization_servers: ["https://auth.example.com"],
      },
      validateToken: async () => ({ valid: false, error: "Token expired" }),
    };

    const result = await validateOAuth(request, scheme);
    expect(result.valid).toBe(false);
  });

  test("validateOAuth fails with missing token", async () => {
    const request = createMockRequest({});

    const scheme: OAuthScheme = {
      type: "oauth2",
      resourceMetadata: {
        resource: "https://example.com/mcp",
        authorization_servers: ["https://auth.example.com"],
      },
      validateToken: async () => ({ valid: true }),
    };

    const result = await validateOAuth(request, scheme);
    expect(result.valid).toBe(false);
  });
});

// =============================================================================
// HMAC Scheme Tests
// =============================================================================

describe("HMAC Scheme", () => {
  const secret = "my-shared-secret";

  test("validateHMAC succeeds with valid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = '{"jsonrpc":"2.0","method":"ping"}';
    const signature = await computeHmacSignature(secret, "POST", "/mcp", timestamp, body);

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Signature": signature,
        "X-AWP-Timestamp": timestamp,
      },
      body,
    });

    const scheme: HMACScheme = {
      type: "hmac",
      secret,
    };

    const result = await validateHMAC(request, scheme);
    expect(result.valid).toBe(true);
  });

  test("validateHMAC fails with invalid signature", async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Signature": "invalid-signature",
        "X-AWP-Timestamp": timestamp,
      },
      body: "{}",
    });

    const scheme: HMACScheme = {
      type: "hmac",
      secret,
    };

    const result = await validateHMAC(request, scheme);
    expect(result.valid).toBe(false);
  });

  test("validateHMAC fails with expired timestamp", async () => {
    const expiredTimestamp = String(Math.floor(Date.now() / 1000) - 600); // 10 minutes ago
    const body = "{}";
    const signature = await computeHmacSignature(secret, "POST", "/mcp", expiredTimestamp, body);

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Signature": signature,
        "X-AWP-Timestamp": expiredTimestamp,
      },
      body,
    });

    const scheme: HMACScheme = {
      type: "hmac",
      secret,
      maxClockSkew: 300, // 5 minutes
    };

    const result = await validateHMAC(request, scheme);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.error).toContain("timestamp");
    }
  });

  test("validateHMAC fails with missing signature header", async () => {
    const request = createMockRequest({
      headers: {
        "X-AWP-Timestamp": String(Math.floor(Date.now() / 1000)),
      },
    });

    const scheme: HMACScheme = {
      type: "hmac",
      secret,
    };

    const result = await validateHMAC(request, scheme);
    expect(result.valid).toBe(false);
  });

  test("validateHMAC supports function-based secret lookup", async () => {
    const secrets: Record<string, string> = {
      "service-a": "secret-for-a",
      "service-b": "secret-for-b",
    };

    const timestamp = String(Math.floor(Date.now() / 1000));
    const body = "{}";
    const signature = await computeHmacSignature(
      secrets["service-a"]!,
      "POST",
      "/mcp",
      timestamp,
      body
    );

    const request = createMockRequest({
      url: "https://example.com/mcp",
      method: "POST",
      headers: {
        "X-AWP-Signature": signature,
        "X-AWP-Timestamp": timestamp,
        "X-AWP-Key-Id": "service-a",
      },
      body,
    });

    const scheme: HMACScheme = {
      type: "hmac",
      secret: async (keyId) => secrets[keyId] ?? null,
    };

    const result = await validateHMAC(request, scheme);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.context.keyId).toBe("service-a");
    }
  });
});

// =============================================================================
// API Key Scheme Tests
// =============================================================================

describe("API Key Scheme", () => {
  test("validateAPIKey succeeds with valid key", async () => {
    const request = createMockRequest({
      headers: { "X-API-Key": "valid-api-key" },
    });

    const scheme: APIKeyScheme = {
      type: "api_key",
      validateKey: async (key) => ({
        valid: key === "valid-api-key",
        metadata: { tier: "premium" },
      }),
    };

    const result = await validateAPIKey(request, scheme);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.context.scheme).toBe("api_key");
      expect(result.context.metadata?.tier).toBe("premium");
    }
  });

  test("validateAPIKey fails with invalid key", async () => {
    const request = createMockRequest({
      headers: { "X-API-Key": "invalid-key" },
    });

    const scheme: APIKeyScheme = {
      type: "api_key",
      validateKey: async () => ({ valid: false, error: "Unknown API key" }),
    };

    const result = await validateAPIKey(request, scheme);
    expect(result.valid).toBe(false);
  });

  test("validateAPIKey fails with missing key", async () => {
    const request = createMockRequest({});

    const scheme: APIKeyScheme = {
      type: "api_key",
      validateKey: async () => ({ valid: true }),
    };

    const result = await validateAPIKey(request, scheme);
    expect(result.valid).toBe(false);
  });

  test("validateAPIKey uses custom header name", async () => {
    const request = createMockRequest({
      headers: { "X-Custom-Key": "my-key" },
    });

    const scheme: APIKeyScheme = {
      type: "api_key",
      header: "X-Custom-Key",
      validateKey: async (key) => ({ valid: key === "my-key" }),
    };

    const result = await validateAPIKey(request, scheme);
    expect(result.valid).toBe(true);
  });
});

// =============================================================================
// Middleware Tests
// =============================================================================

describe("Auth Middleware", () => {
  test("middleware allows excluded paths without auth", async () => {
    const middleware = createAuthMiddleware({
      schemes: [
        {
          type: "api_key",
          validateKey: async () => ({ valid: false }),
        },
      ],
    });

    const request = createMockRequest({
      url: "https://example.com/.well-known/oauth-protected-resource",
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(true);
  });

  test("middleware tries schemes in order until one succeeds", async () => {
    const callOrder: string[] = [];

    const middleware = createAuthMiddleware({
      schemes: [
        {
          type: "oauth2",
          resourceMetadata: {
            resource: "https://example.com/mcp",
            authorization_servers: ["https://auth.example.com"],
          },
          validateToken: async () => {
            callOrder.push("oauth");
            return { valid: false }; // OAuth fails
          },
        },
        {
          type: "api_key",
          validateKey: async () => {
            callOrder.push("api_key");
            return { valid: true }; // API Key succeeds
          },
        },
      ],
    });

    // Include Bearer token so OAuth validateToken gets called
    const request = createMockRequest({
      url: "https://example.com/mcp",
      headers: {
        Authorization: "Bearer some-token",
        "X-API-Key": "test",
      },
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(true);
    expect(callOrder).toEqual(["oauth", "api_key"]);
  });

  test("middleware stops at first successful scheme", async () => {
    const callOrder: string[] = [];

    const middleware = createAuthMiddleware({
      schemes: [
        {
          type: "oauth2",
          resourceMetadata: {
            resource: "https://example.com/mcp",
            authorization_servers: ["https://auth.example.com"],
          },
          validateToken: async () => {
            callOrder.push("oauth");
            return { valid: true }; // OAuth succeeds
          },
        },
        {
          type: "api_key",
          validateKey: async () => {
            callOrder.push("api_key");
            return { valid: true };
          },
        },
      ],
    });

    const request = createMockRequest({
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer valid-token" },
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(true);
    // Should stop at OAuth, not try API Key
    expect(callOrder).toEqual(["oauth"]);
  });

  test("middleware returns challenge response when all schemes fail", async () => {
    const middleware = createAuthMiddleware({
      schemes: [
        {
          type: "api_key",
          validateKey: async () => ({ valid: false }),
        },
      ],
    });

    const request = createMockRequest({
      url: "https://example.com/mcp",
    });

    const result = await middleware(request);
    expect(result.authorized).toBe(false);
    expect(result.challengeResponse).toBeDefined();
    expect(result.challengeResponse!.status).toBe(401);
  });
});

// =============================================================================
// Challenge Response Tests
// =============================================================================

describe("Challenge Response", () => {
  test("buildChallengeResponse includes all schemes", async () => {
    const config: AuthConfig = {
      schemes: [
        {
          type: "oauth2",
          resourceMetadata: {
            resource: "https://example.com/mcp",
            authorization_servers: ["https://auth.example.com"],
          },
          validateToken: async () => ({ valid: false }),
        },
        {
          type: "api_key",
          validateKey: async () => ({ valid: false }),
        },
      ],
    };

    const response = buildChallengeResponse({
      baseUrl: "https://example.com",
      config,
    });

    expect(response.status).toBe(401);

    // Check WWW-Authenticate headers
    const wwwAuth = response.headers.get("WWW-Authenticate");
    expect(wwwAuth).toContain("Bearer");
    expect(wwwAuth).toContain("X-API-Key");

    // Check body
    const body = (await response.json()) as {
      error: string;
      supported_schemes: Array<{ scheme: string }>;
    };
    expect(body.error).toBe("unauthorized");
    expect(body.supported_schemes).toHaveLength(2);
    expect(body.supported_schemes[0]!.scheme).toBe("oauth2");
    expect(body.supported_schemes[1]!.scheme).toBe("api_key");
  });

  test("getBaseUrl extracts origin from URL", () => {
    const request = createMockRequest({
      url: "https://api.example.com/mcp",
    });
    const baseUrl = getBaseUrl(request);
    expect(baseUrl).toBe("https://api.example.com");
  });

  test("getBaseUrl respects X-Forwarded headers", () => {
    const request = createMockRequest({
      url: "http://localhost:3000/mcp",
      headers: {
        "X-Forwarded-Proto": "https",
        "X-Forwarded-Host": "api.example.com",
      },
    });
    const baseUrl = getBaseUrl(request);
    expect(baseUrl).toBe("https://api.example.com");
  });
});

// =============================================================================
// Well-Known Endpoint Tests
// =============================================================================

describe("Well-Known Endpoints", () => {
  const oauthConfig: AuthConfig = {
    schemes: [
      {
        type: "oauth2",
        resourceMetadata: {
          resource: "https://example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["read", "write"],
        },
        validateToken: async () => ({ valid: false }),
      },
    ],
  };

  test("handleWellKnown returns PRM for OAuth config", async () => {
    const request = createMockRequest({
      url: `https://example.com${WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE}`,
    });

    const response = handleWellKnown(request, oauthConfig);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);

    const body = (await response!.json()) as {
      resource: string;
      authorization_servers: string[];
      scopes_supported: string[];
    };
    expect(body.resource).toBe("https://example.com/mcp");
    expect(body.authorization_servers).toContain("https://auth.example.com");
    expect(body.scopes_supported).toEqual(["read", "write"]);
  });

  test("handleWellKnown returns 404 without OAuth config", async () => {
    const request = createMockRequest({
      url: `https://example.com${WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE}`,
    });

    const config: AuthConfig = {
      schemes: [
        {
          type: "api_key",
          validateKey: async () => ({ valid: false }),
        },
      ],
    };

    const response = handleWellKnown(request, config);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
  });

  test("handleWellKnown returns null for non-well-known paths", () => {
    const request = createMockRequest({
      url: "https://example.com/mcp",
    });

    const response = handleWellKnown(request, oauthConfig);
    expect(response).toBeNull();
  });

  test("createWellKnownHandler returns reusable handler", async () => {
    const handler = createWellKnownHandler(oauthConfig);

    const request = createMockRequest({
      url: `https://example.com${WELL_KNOWN_PATHS.OAUTH_PROTECTED_RESOURCE}`,
    });

    const response = handler(request);
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
  });
});

// =============================================================================
// hasAuthCredentials Tests
// =============================================================================

describe("hasAuthCredentials", () => {
  const config: AuthConfig = {
    schemes: [
      {
        type: "oauth2",
        resourceMetadata: {
          resource: "https://example.com/mcp",
          authorization_servers: ["https://auth.example.com"],
        },
        validateToken: async () => ({ valid: false }),
      },
      {
        type: "hmac",
        secret: "test",
      },
      {
        type: "api_key",
        validateKey: async () => ({ valid: false }),
      },
    ],
  };

  test("detects Bearer token", () => {
    const request = createMockRequest({
      headers: { Authorization: "Bearer token" },
    });
    expect(hasAuthCredentials(request, config)).toBe(true);
  });

  test("detects HMAC signature", () => {
    const request = createMockRequest({
      headers: { "X-AWP-Signature": "sig" },
    });
    expect(hasAuthCredentials(request, config)).toBe(true);
  });

  test("detects API key", () => {
    const request = createMockRequest({
      headers: { "X-API-Key": "key" },
    });
    expect(hasAuthCredentials(request, config)).toBe(true);
  });

  test("returns false without credentials", () => {
    const request = createMockRequest({});
    expect(hasAuthCredentials(request, config)).toBe(false);
  });
});
