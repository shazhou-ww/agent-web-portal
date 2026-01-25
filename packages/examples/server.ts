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
  type AuthorizedPubkey,
  completeAuthorization,
  createAwpAuthMiddleware,
  MemoryPendingAuthStore,
  MemoryPubkeyStore,
  routeAuthRequest,
} from "@agent-web-portal/auth";
import {
  createClearSessionCookie,
  createSession,
  createSessionCookie,
  getSessionFromRequest,
  validateCredentials,
} from "./src/auth/session.ts";
import { getAuthPageHtml, getAuthSuccessHtml } from "./src/auth/ui.ts";
import {
  createOutputBlobSlot,
  getStoredImage,
  getTempUpload,
  listStoredImages,
  readOutputBlob,
  storeImage,
  storeTempUpload,
  writeOutputBlob,
} from "./src/portals/blob.ts";
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

  // ==========================================================================
  // Blob Storage API routes (for demo/testing)
  // These APIs simulate S3-like presigned URL functionality
  // ==========================================================================

  // Prepare upload - upload file and get a temporary presigned GET URL (5 min TTL)
  // This is used by UI to upload a file before calling put_image tool
  if (pathname === "/blob/prepare-upload" && req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") ?? "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const file = formData.get("image") as File | null;

        if (!file) {
          return new Response(JSON.stringify({ error: "No image file provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await file.arrayBuffer();
        const result = storeTempUpload(data, file.type || "image/png");

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Handle raw binary upload
      const data = await req.arrayBuffer();
      const imageContentType = contentType.startsWith("image/") ? contentType : "image/png";
      const result = storeTempUpload(data, imageContentType);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to prepare upload" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Get temporary upload (presigned GET URL equivalent)
  if (pathname.startsWith("/blob/temp/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/blob/temp/".length));
    const upload = getTempUpload(id);

    if (!upload) {
      return new Response(JSON.stringify({ error: "Temporary upload not found or expired" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(upload.data, {
      status: 200,
      headers: {
        "Content-Type": upload.contentType,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Prepare download - create output blob slot and get presigned URLs
  // This is used by UI before calling get_image tool
  if (pathname === "/blob/prepare-download" && req.method === "POST") {
    const result = createOutputBlobSlot();
    return new Response(JSON.stringify(result), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Write to output blob (presigned PUT URL equivalent)
  if (pathname.startsWith("/blob/output/") && req.method === "PUT") {
    const id = decodeURIComponent(pathname.slice("/blob/output/".length));
    const contentType = req.headers.get("content-type") ?? "application/octet-stream";
    const data = await req.arrayBuffer();

    const success = writeOutputBlob(id, data, contentType);

    if (!success) {
      return new Response(JSON.stringify({ error: "Output blob not found or expired" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Read from output blob (presigned GET URL equivalent for reading after write)
  if (pathname.startsWith("/blob/output/") && req.method === "GET") {
    const id = decodeURIComponent(pathname.slice("/blob/output/".length));
    const blob = readOutputBlob(id);

    if (!blob) {
      return new Response(JSON.stringify({ error: "Output blob not found or expired" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(blob.data, {
      status: 200,
      headers: {
        "Content-Type": blob.contentType,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // Direct upload to permanent storage (legacy, still useful)
  if (pathname === "/blob/upload" && req.method === "POST") {
    try {
      const contentType = req.headers.get("content-type") ?? "";

      if (contentType.includes("multipart/form-data")) {
        const formData = await req.formData();
        const file = formData.get("image") as File | null;

        if (!file) {
          return new Response(JSON.stringify({ error: "No image file provided" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const data = await file.arrayBuffer();
        const result = storeImage(data, file.type || "image/png");

        return new Response(JSON.stringify(result), {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        });
      }

      // Handle raw binary upload
      const data = await req.arrayBuffer();
      const imageContentType = contentType.startsWith("image/") ? contentType : "image/png";
      const result = storeImage(data, imageContentType);

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response(JSON.stringify({ error: "Failed to upload image" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Download image from permanent storage
  if (pathname.startsWith("/blob/files/") && req.method === "GET") {
    const key = decodeURIComponent(pathname.slice("/blob/files/".length));
    const image = getStoredImage(key);

    if (!image) {
      return new Response(JSON.stringify({ error: "Image not found or expired" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(image.data, {
      status: 200,
      headers: {
        "Content-Type": image.contentType,
        "Content-Disposition": `inline; filename="${key.split("/").pop()}"`,
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // List images in permanent storage
  if (pathname === "/blob/files" && req.method === "GET") {
    const images = listStoredImages();
    return new Response(JSON.stringify({ images, count: images.length }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }

  // ==========================================================================
  // Session API routes
  // ==========================================================================

  // Login API (JSON)
  if (pathname === "/api/login" && req.method === "POST") {
    try {
      const body = await req.json();
      const { username, password } = body as { username: string; password: string };

      const user = validateCredentials(username, password);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid username or password" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const { sessionId, session } = createSession(user);
      return new Response(
        JSON.stringify({
          success: true,
          user: { userId: session.userId, username: session.username },
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Set-Cookie": createSessionCookie(sessionId),
          },
        }
      );
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // Logout API
  if (pathname === "/api/logout" && req.method === "POST") {
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Set-Cookie": createClearSessionCookie(),
      },
    });
  }

  // Get current user session
  if (pathname === "/api/me" && req.method === "GET") {
    const session = getSessionFromRequest(req);
    if (!session) {
      return new Response(JSON.stringify({ authenticated: false }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        authenticated: true,
        user: { userId: session.userId, username: session.username },
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // ==========================================================================
  // Client Management API routes
  // ==========================================================================

  // List authorized clients for current user
  if (pathname === "/api/clients" && req.method === "GET") {
    const session = getSessionFromRequest(req);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const clients = await pubkeyStore.listByUser(session.userId);
    return new Response(
      JSON.stringify({
        clients: clients.map((c: AuthorizedPubkey) => ({
          pubkey: c.pubkey,
          clientName: c.clientName,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  // Revoke a client authorization
  if (pathname.startsWith("/api/clients/") && req.method === "DELETE") {
    const session = getSessionFromRequest(req);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract pubkey from URL (URL-encoded)
    const pubkeyEncoded = pathname.slice("/api/clients/".length);
    const pubkey = decodeURIComponent(pubkeyEncoded);

    // Verify the pubkey belongs to this user
    const authInfo = await pubkeyStore.lookup(pubkey);
    if (!authInfo || authInfo.userId !== session.userId) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await pubkeyStore.revoke(pubkey);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Renew a client authorization
  if (pathname.startsWith("/api/clients/") && req.method === "PATCH") {
    const session = getSessionFromRequest(req);
    if (!session) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Extract pubkey from URL
    const pubkeyEncoded = pathname.slice("/api/clients/".length);
    const pubkey = decodeURIComponent(pubkeyEncoded);

    // Verify the pubkey belongs to this user
    const authInfo = await pubkeyStore.lookup(pubkey);
    if (!authInfo || authInfo.userId !== session.userId) {
      return new Response(JSON.stringify({ error: "Client not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    try {
      const body = await req.json();
      const { expiresIn } = body as { expiresIn?: number };

      // Update expiration
      const newExpiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
      const updatedAuth: AuthorizedPubkey = {
        ...authInfo,
        expiresAt: newExpiresAt,
      };
      await pubkeyStore.store(updatedAuth);

      return new Response(
        JSON.stringify({
          success: true,
          client: {
            pubkey: updatedAuth.pubkey,
            clientName: updatedAuth.clientName,
            createdAt: updatedAuth.createdAt,
            expiresAt: updatedAuth.expiresAt,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    } catch {
      return new Response(JSON.stringify({ error: "Invalid request body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  // ==========================================================================
  // Auth portal routes
  // ==========================================================================

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

    // Handle AWP auth endpoints (/auth/init, /auth/status)
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

    // Auth page - redirect to login if not authenticated
    if (pathname === "/auth/page") {
      const session = getSessionFromRequest(req);
      const pubkey = url.searchParams.get("pubkey") ?? "";

      if (!session) {
        // Redirect to login with return URL
        const returnUrl = encodeURIComponent(`/auth/page?pubkey=${encodeURIComponent(pubkey)}`);
        return new Response(null, {
          status: 302,
          headers: { Location: `/login?returnUrl=${returnUrl}` },
        });
      }

      // Get pending auth info to show client name
      const pendingAuth = await pendingAuthStore.get(pubkey);
      return new Response(
        getAuthPageHtml(undefined, pendingAuth?.clientName, pendingAuth?.verificationCode),
        {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }
      );
    }

    // Auth success page
    if (pathname === "/auth/success") {
      return new Response(getAuthSuccessHtml(), {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }

    // Auth complete - verify code and authorize (requires session)
    if (pathname === "/auth/complete" && req.method === "POST") {
      const session = getSessionFromRequest(req);
      if (!session) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      try {
        const body = await req.json();
        const { pubkey, verification_code, expires_in } = body as {
          pubkey: string;
          verification_code: string;
          expires_in?: number;
        };

        const result = await completeAuthorization(pubkey, verification_code, session.userId, {
          pendingAuthStore,
          pubkeyStore,
          authorizationTTL: expires_in,
        });

        if (result.success) {
          return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        return new Response(
          JSON.stringify({ error: result.error, error_description: result.errorDescription }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }
        );
      } catch {
        return new Response(JSON.stringify({ error: "Invalid request body" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // Legacy login form handler (for backward compatibility)
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

      const user = validateCredentials(username, password);
      if (!user) {
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
        // Create session and set cookie
        const { sessionId } = createSession(user);
        return new Response(getAuthSuccessHtml(), {
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Set-Cookie": createSessionCookie(sessionId),
          },
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
          new Response(
            JSON.stringify({ error: "unauthorized", error_description: "Invalid credentials" }),
            {
              status: 401,
              headers: { "Content-Type": "application/json" },
            }
          )
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
