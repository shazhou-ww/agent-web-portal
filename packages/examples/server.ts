/**
 * Local Development Server for AWP Examples
 *
 * This is a Bun-based server for local development and testing.
 * For production, use the Lambda handler with SAM.
 *
 * Run with: bun run server.ts
 */

import {
  type AuthHttpRequest,
  completeAuthorization,
  createAwpAuthMiddleware,
  MemoryPendingAuthStore,
  MemoryPubkeyStore,
  routeAuthRequest,
} from "@agent-web-portal/auth";
import { getAuthPageHtml, getAuthSuccessHtml } from "./src/auth/ui.ts";
import {
  authPortal,
  basicPortal,
  blobPortal,
  ecommercePortal,
  jsonataPortal,
} from "./src/portals/index.ts";

// =============================================================================
// Configuration
// =============================================================================

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Built-in test users
const TEST_USERS: Record<string, { password: string; userId: string }> = {
  test: { password: "test123", userId: "test-user-001" },
  admin: { password: "admin123", userId: "admin-user-001" },
  demo: { password: "demo", userId: "demo-user-001" },
};

// =============================================================================
// Auth Stores (in-memory for local development)
// =============================================================================

const pendingAuthStore = new MemoryPendingAuthStore();
const pubkeyStore = new MemoryPubkeyStore();

const authMiddleware = createAwpAuthMiddleware({
  pendingAuthStore,
  pubkeyStore,
  authInitPath: "/auth/init",
  authStatusPath: "/auth/status",
  authPagePath: "/auth/page",
});

// =============================================================================
// Request Handler
// =============================================================================

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pathname = url.pathname;

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, Mcp-Session-Id, X-AWP-Signature, X-AWP-Pubkey, X-AWP-Timestamp",
      },
    });
  }

  // Health check
  if (pathname === "/health" || pathname === "/healthz" || pathname === "/ping") {
    return new Response(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Basic portal
  if (pathname === "/basic" || pathname === "/basic/mcp") {
    return basicPortal.handleRequest(req);
  }

  // E-commerce portal
  if (pathname === "/ecommerce" || pathname === "/ecommerce/mcp") {
    return ecommercePortal.handleRequest(req);
  }

  // JSONata portal
  if (pathname === "/jsonata" || pathname === "/jsonata/mcp") {
    return jsonataPortal.handleRequest(req);
  }

  // Blob portal
  if (pathname === "/blob" || pathname === "/blob/mcp") {
    return blobPortal.handleRequest(req);
  }

  // Auth portal routes
  if (pathname.startsWith("/auth")) {
    const authReq: AuthHttpRequest = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      text: () => req.clone().text(),
      clone: () => ({
        method: req.method,
        url: req.url,
        headers: req.headers,
        text: () => req.clone().text(),
        clone: () => authReq.clone(),
      }),
    };

    // Handle AWP auth endpoints
    const authRouteResponse = await routeAuthRequest(authReq, {
      baseUrl: `http://localhost:${PORT}`,
      pendingAuthStore,
      pubkeyStore,
      authInitPath: "/auth/init",
      authStatusPath: "/auth/status",
      authPagePath: "/auth/page",
    });
    if (authRouteResponse) {
      return authRouteResponse;
    }

    // Auth page
    if (pathname === "/auth/page") {
      return new Response(getAuthPageHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Login form handler
    if (pathname === "/auth/login" && req.method === "POST") {
      const contentType = req.headers.get("content-type") ?? "";
      const formData: Record<string, string> = {};

      if (contentType.includes("application/x-www-form-urlencoded")) {
        const text = await req.text();
        const params = new URLSearchParams(text);
        for (const [key, value] of params) {
          formData[key] = value;
        }
      } else if (contentType.includes("multipart/form-data")) {
        const data = await req.formData();
        data.forEach((value, key) => {
          if (typeof value === "string") {
            formData[key] = value;
          }
        });
      }

      const username = formData.username ?? "";
      const password = formData.password ?? "";
      const verificationCode = formData.verification_code ?? "";
      const pubkey = formData.pubkey ?? "";

      const user = TEST_USERS[username];
      if (!user || user.password !== password) {
        return new Response(getAuthPageHtml("Invalid username or password"), {
          status: 401,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      const result = await completeAuthorization(pubkey, verificationCode, user.userId, {
        pendingAuthStore,
        pubkeyStore,
      });

      if (result.success) {
        return new Response(getAuthSuccessHtml(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      return new Response(getAuthPageHtml(result.errorDescription ?? "Authorization failed"), {
        status: 400,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Auth MCP endpoint
    if (pathname === "/auth" || pathname === "/auth/mcp") {
      const authResult = await authMiddleware(authReq);
      if (!authResult.authorized) {
        // Return challenge response or a generic 401 if no challenge provided
        return (
          authResult.challengeResponse ??
          new Response(JSON.stringify({ error: "unauthorized", error_description: "Invalid credentials" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          })
        );
      }
      return authPortal.handleRequest(req);
    }
  }

  // API info
  if (pathname === "/api" || pathname === "/") {
    return new Response(
      JSON.stringify({
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
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  }

  // 404
  return new Response(JSON.stringify({ error: "Not Found", path: pathname }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

// =============================================================================
// Start Server
// =============================================================================

const server = Bun.serve({
  port: PORT,
  fetch: handleRequest,
});

console.log(`
🌐 AWP Examples - Local Development Server
   URL: http://localhost:${PORT}

📡 Available Portals:
   - /basic     - Basic greeting portal
   - /ecommerce - E-commerce portal  
   - /jsonata   - JSONata expression portal
   - /auth      - Auth-enabled portal
   - /blob      - Blob-enabled portal

🔐 Auth Endpoints:
   - POST /auth/init   - Initialize auth
   - GET  /auth/status - Check auth status
   - GET  /auth/page   - Login page

👤 Test Users:
   - test / test123
   - admin / admin123
   - demo / demo

Press Ctrl+C to stop.
`);

export { server, pendingAuthStore, pubkeyStore, PORT };
