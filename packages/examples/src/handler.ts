/**
 * Lambda Handler for Examples Portal
 *
 * Routes requests to multiple portals based on path prefix:
 * - /basic/*     -> Basic greeting portal
 * - /ecommerce/* -> E-commerce portal
 * - /jsonata/*   -> JSONata portal
 * - /auth/*      -> Auth-enabled portal
 * - /blob/*      -> Blob portal
 * - /ui/*        -> Static UI assets
 */

import {
  type AuthHttpRequest,
  completeAuthorization,
  createAwpAuthMiddleware,
  routeAuthRequest,
} from "@agent-web-portal/auth";
import {
  type APIGatewayProxyEvent,
  type APIGatewayProxyResult,
  DynamoDBPendingAuthStore,
  DynamoDBPubkeyStore,
  type LambdaContext,
} from "@agent-web-portal/aws-lambda";
import { getAuthPageHtml, getAuthSuccessHtml } from "./auth/ui.ts";
import {
  authPortal,
  basicPortal,
  blobPortal,
  ecommercePortal,
  jsonataPortal,
} from "./portals/index.ts";
import { serveStaticAssets } from "./static.ts";

// =============================================================================
// Configuration
// =============================================================================

const AUTH_TABLE = process.env.AUTH_TABLE ?? "awp-examples-auth";
const AWS_REGION = process.env.AWS_REGION ?? "us-east-1";

// Built-in test users
const TEST_USERS: Record<string, { password: string; userId: string }> = {
  test: { password: "test123", userId: "test-user-001" },
  admin: { password: "admin123", userId: "admin-user-001" },
  demo: { password: "demo", userId: "demo-user-001" },
};

// =============================================================================
// Auth Stores
// =============================================================================

const pendingAuthStore = new DynamoDBPendingAuthStore({
  tableName: AUTH_TABLE,
  region: AWS_REGION,
});

const pubkeyStore = new DynamoDBPubkeyStore({
  tableName: AUTH_TABLE,
  region: AWS_REGION,
});

// Auth middleware
const authMiddleware = createAwpAuthMiddleware({
  pendingAuthStore,
  pubkeyStore,
  authInitPath: "/auth/init",
  authStatusPath: "/auth/status",
  authPagePath: "/auth/page",
});

// =============================================================================
// Request Conversion Helpers
// =============================================================================

function createAuthRequest(event: APIGatewayProxyEvent, baseUrl: string): AuthHttpRequest {
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body
    : "";

  const headers = new Headers(event.headers as Record<string, string>);

  const request: AuthHttpRequest = {
    method: event.httpMethod,
    url: `${baseUrl}${event.path}`,
    headers,
    text: async () => body,
    clone: () => createAuthRequest(event, baseUrl),
  };

  return request;
}

function createWebRequest(event: APIGatewayProxyEvent, baseUrl: string): Request {
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, "base64").toString("utf-8")
      : event.body
    : undefined;

  const headers = new Headers(event.headers as Record<string, string>);
  const url = `${baseUrl}${event.path}`;

  return new Request(url, {
    method: event.httpMethod,
    headers,
    body: event.httpMethod !== "GET" && event.httpMethod !== "HEAD" ? body : undefined,
  });
}

async function responseToApiGateway(response: Response): Promise<APIGatewayProxyResult> {
  const body = await response.text();
  const headers: Record<string, string> = {};

  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body,
  };
}

// =============================================================================
// Form Data Parser
// =============================================================================

function parseFormData(body: string, contentType: string): Record<string, string> {
  const result: Record<string, string> = {};

  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(body);
    for (const [key, value] of params) {
      result[key] = value;
    }
  } else if (contentType.includes("multipart/form-data")) {
    // Simple multipart parser - extract boundary and parse
    const boundaryMatch = contentType.match(/boundary=(.+)/);
    if (boundaryMatch) {
      const boundary = boundaryMatch[1]!;
      const parts = body.split(`--${boundary}`);
      for (const part of parts) {
        const nameMatch = part.match(/name="([^"]+)"/);
        if (nameMatch) {
          const name = nameMatch[1]!;
          const valueMatch = part.split("\r\n\r\n")[1];
          if (valueMatch) {
            result[name] = valueMatch.replace(/\r\n--$/, "").trim();
          }
        }
      }
    }
  }

  return result;
}

// =============================================================================
// Lambda Handler
// =============================================================================

export async function handler(
  event: APIGatewayProxyEvent,
  _context: LambdaContext
): Promise<APIGatewayProxyResult> {
  const { path, httpMethod } = event;

  // Build base URL
  const protocol = event.headers["x-forwarded-proto"] ?? "https";
  const host = event.headers.host ?? event.headers.Host ?? "localhost";
  const baseUrl = `${protocol}://${host}`;

  try {
    // Handle CORS preflight
    if (httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers":
            "Content-Type, Authorization, Mcp-Session-Id, X-AWP-Signature, X-AWP-Pubkey, X-AWP-Timestamp",
        },
        body: "",
      };
    }

    // Health check
    if (path === "/health" || path === "/healthz" || path === "/ping") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      };
    }

    // Static UI assets
    if (path.startsWith("/ui") || path === "/" || path === "/index.html") {
      return serveStaticAssets(event, path);
    }

    // Basic portal
    if (path === "/basic" || path === "/basic/mcp") {
      const req = createWebRequest(event, baseUrl);
      const res = await basicPortal.handleRequest(req);
      return responseToApiGateway(res);
    }

    // E-commerce portal
    if (path === "/ecommerce" || path === "/ecommerce/mcp") {
      const req = createWebRequest(event, baseUrl);
      const res = await ecommercePortal.handleRequest(req);
      return responseToApiGateway(res);
    }

    // JSONata portal
    if (path === "/jsonata" || path === "/jsonata/mcp") {
      const req = createWebRequest(event, baseUrl);
      const res = await jsonataPortal.handleRequest(req);
      return responseToApiGateway(res);
    }

    // Blob portal
    if (path === "/blob" || path === "/blob/mcp") {
      const req = createWebRequest(event, baseUrl);
      const res = await blobPortal.handleRequest(req);
      return responseToApiGateway(res);
    }

    // Auth portal routes
    if (path.startsWith("/auth")) {
      const authReq = createAuthRequest(event, baseUrl);

      // Handle AWP auth endpoints (/auth/init, /auth/status)
      const authRouteResponse = await routeAuthRequest(authReq, {
        baseUrl,
        pendingAuthStore,
        pubkeyStore,
        authInitPath: "/auth/init",
        authStatusPath: "/auth/status",
        authPagePath: "/auth/page",
      });
      if (authRouteResponse) {
        return responseToApiGateway(authRouteResponse);
      }

      // Auth page - login UI
      if (path === "/auth/page") {
        return {
          statusCode: 200,
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body: getAuthPageHtml(),
        };
      }

      // Handle login form submission
      if (path === "/auth/login" && httpMethod === "POST") {
        const contentType = event.headers["content-type"] ?? event.headers["Content-Type"] ?? "";
        const body = event.body
          ? event.isBase64Encoded
            ? Buffer.from(event.body, "base64").toString("utf-8")
            : event.body
          : "";

        const formData = parseFormData(body, contentType);
        const username = formData.username ?? "";
        const password = formData.password ?? "";
        const verificationCode = formData.verification_code ?? "";
        const pubkey = formData.pubkey ?? "";

        const user = TEST_USERS[username];
        if (!user || user.password !== password) {
          return {
            statusCode: 401,
            headers: { "Content-Type": "text/html; charset=utf-8" },
            body: getAuthPageHtml("Invalid username or password"),
          };
        }

        // Complete authorization
        const result = await completeAuthorization(pubkey, verificationCode, user.userId, {
          pendingAuthStore,
          pubkeyStore,
        });

        if (result.success) {
          return {
            statusCode: 200,
            headers: { "Content-Type": "text/html; charset=utf-8" },
            body: getAuthSuccessHtml(),
          };
        }

        return {
          statusCode: 400,
          headers: { "Content-Type": "text/html; charset=utf-8" },
          body: getAuthPageHtml(result.errorDescription ?? "Authorization failed"),
        };
      }

      // Auth MCP endpoint (requires authentication)
      if (path === "/auth" || path === "/auth/mcp") {
        const authResult = await authMiddleware(authReq);
        if (!authResult.authorized) {
          if (authResult.challengeResponse) {
            return responseToApiGateway(authResult.challengeResponse);
          }
          return {
            statusCode: 401,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ error: "Unauthorized" }),
          };
        }

        const req = createWebRequest(event, baseUrl);
        const res = await authPortal.handleRequest(req);
        return responseToApiGateway(res);
      }
    }

    // Root route - show available portals
    if (path === "/api" || path === "/api/") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Agent Web Portal - Examples",
          portals: {
            basic: { endpoint: "/basic", description: "Basic greeting portal" },
            ecommerce: { endpoint: "/ecommerce", description: "E-commerce portal" },
            jsonata: { endpoint: "/jsonata", description: "JSONata expression portal" },
            auth: { endpoint: "/auth", description: "Auth-enabled portal" },
            blob: { endpoint: "/blob", description: "Blob-enabled portal" },
          },
          auth: {
            init: "/auth/init",
            status: "/auth/status",
            page: "/auth/page",
          },
          ui: "/ui",
        }),
      };
    }

    // 404 Not Found
    return {
      statusCode: 404,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Not Found", path }),
    };
  } catch (error) {
    console.error("Lambda handler error:", error);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        error: "Internal Server Error",
        message: error instanceof Error ? error.message : "Unknown error",
      }),
    };
  }
}
