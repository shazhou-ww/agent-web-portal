/**
 * CAS Stack - HTTP Router
 */

import type { HttpRequest, HttpResponse, CasConfig, AuthContext } from "./types.ts";
import { AuthMiddleware } from "./middleware/auth.ts";
import { AuthService } from "./auth/service.ts";
import { CasStorage } from "./cas/storage.ts";
import { TokensDb, OwnershipDb, DagDb, AwpPendingAuthStore, AwpPubkeyStore } from "./db/index.ts";
import { handleAuthInit, handleAuthStatus, generateVerificationCode } from "@agent-web-portal/auth";
import { z } from "zod";

// ============================================================================
// Request Validation Schemas
// ============================================================================

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

const AwpAuthInitSchema = z.object({
  pubkey: z.string().min(1),
  client_name: z.string().min(1),
});

const AwpAuthCompleteSchema = z.object({
  pubkey: z.string().min(1),
  verification_code: z.string().min(1),
});

const CreateTicketSchema = z.object({
  type: z.enum(["read", "write"]),
  key: z.string().optional(),
  expiresIn: z.number().positive().optional(),
});

const ResolveSchema = z.object({
  root: z.string(),
  nodes: z.array(z.string()),
});

// ============================================================================
// Response Helpers
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

function jsonResponse(status: number, body: unknown): HttpResponse {
  return {
    statusCode: status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
    body: JSON.stringify(body),
  };
}

function binaryResponse(
  content: Buffer,
  contentType: string,
  casKey?: string
): HttpResponse {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": content.length.toString(),
      ...(casKey && { "X-CAS-Key": casKey }),
      ...CORS_HEADERS,
    },
    body: content.toString("base64"),
    isBase64Encoded: true,
  };
}

function errorResponse(status: number, error: string, details?: unknown): HttpResponse {
  return jsonResponse(status, { error, details });
}

// ============================================================================
// Router
// ============================================================================

export class Router {
  private config: CasConfig;
  private authMiddleware: AuthMiddleware;
  private authService: AuthService;
  private casStorage: CasStorage;
  private tokensDb: TokensDb;
  private ownershipDb: OwnershipDb;
  private dagDb: DagDb;
  private awpPendingStore: AwpPendingAuthStore;
  private awpPubkeyStore: AwpPubkeyStore;

  constructor(config: CasConfig) {
    this.config = config;
    this.tokensDb = new TokensDb(config);
    this.ownershipDb = new OwnershipDb(config);
    this.dagDb = new DagDb(config);
    this.awpPendingStore = new AwpPendingAuthStore(config);
    this.awpPubkeyStore = new AwpPubkeyStore(config);
    this.authMiddleware = new AuthMiddleware(config, this.tokensDb, this.awpPubkeyStore);
    this.authService = new AuthService(config, this.tokensDb);
    this.casStorage = new CasStorage(config);
  }

  /**
   * Route request to appropriate handler
   */
  async handle(req: HttpRequest): Promise<HttpResponse> {
    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return {
        statusCode: 204,
        headers: CORS_HEADERS,
      };
    }

    try {
      // Auth routes (no auth required for some)
      if (req.path.startsWith("/auth/")) {
        return this.handleAuth(req);
      }

      // CAS routes (auth required)
      if (req.path.startsWith("/cas/")) {
        return this.handleCas(req);
      }

      // Health check
      if (req.path === "/" || req.path === "/health") {
        return jsonResponse(200, { status: "ok", service: "cas-stack" });
      }

      return errorResponse(404, "Not found");
    } catch (error: any) {
      console.error("Router error:", error);
      return errorResponse(500, error.message ?? "Internal server error");
    }
  }

  // ============================================================================
  // Auth Routes
  // ============================================================================

  private async handleAuth(req: HttpRequest): Promise<HttpResponse> {
    const path = req.path.replace("/auth", "");

    // POST /auth/login
    if (req.method === "POST" && path === "/login") {
      const body = this.parseJson(req);
      const parsed = LoginSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const result = await this.authService.login(parsed.data);
        return jsonResponse(200, result);
      } catch (error: any) {
        return errorResponse(401, error.message ?? "Authentication failed");
      }
    }

    // POST /auth/refresh
    if (req.method === "POST" && path === "/refresh") {
      const body = this.parseJson(req);
      const parsed = RefreshSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const result = await this.authService.refresh(parsed.data);
        return jsonResponse(200, result);
      } catch (error: any) {
        return errorResponse(401, error.message ?? "Token refresh failed");
      }
    }

    // ========================================================================
    // AWP Auth Routes (agent-tokens namespace)
    // ========================================================================

    // POST /auth/agent-tokens/init - Start AWP auth flow
    if (req.method === "POST" && path === "/agent-tokens/init") {
      const body = this.parseJson(req);
      const parsed = AwpAuthInitSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const verificationCode = generateVerificationCode();
        const now = Date.now();
        const expiresIn = 600; // 10 minutes

        await this.awpPendingStore.create({
          pubkey: parsed.data.pubkey,
          clientName: parsed.data.client_name,
          verificationCode,
          createdAt: now,
          expiresAt: now + expiresIn * 1000,
        });

        // Build auth URL (points to cas-webui)
        const baseUrl = req.headers.origin ?? req.headers.Origin ?? "";
        const authUrl = `${baseUrl}/auth/awp?pubkey=${encodeURIComponent(parsed.data.pubkey)}`;

        return jsonResponse(200, {
          auth_url: authUrl,
          verification_code: verificationCode,
          expires_in: expiresIn,
          poll_interval: 5,
        });
      } catch (error: any) {
        return errorResponse(500, error.message ?? "Failed to initiate auth");
      }
    }

    // GET /auth/agent-tokens/status - Poll for auth completion
    if (req.method === "GET" && path === "/agent-tokens/status") {
      const pubkey = req.query.pubkey;
      if (!pubkey) {
        return errorResponse(400, "Missing pubkey parameter");
      }

      const authorized = await this.awpPubkeyStore.lookup(pubkey);
      if (authorized) {
        return jsonResponse(200, {
          authorized: true,
          expires_at: authorized.expiresAt,
        });
      }

      // Check if pending auth exists
      const pending = await this.awpPendingStore.get(pubkey);
      if (!pending) {
        return jsonResponse(200, {
          authorized: false,
          error: "No pending authorization found",
        });
      }

      return jsonResponse(200, {
        authorized: false,
      });
    }

    // POST /auth/agent-tokens/complete - Complete authorization (requires user auth)
    if (req.method === "POST" && path === "/agent-tokens/complete") {
      // This endpoint requires user authentication
      const auth = await this.authMiddleware.authenticate(req);
      if (!auth) {
        return errorResponse(401, "User authentication required");
      }

      const body = this.parseJson(req);
      const parsed = AwpAuthCompleteSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      // Validate verification code
      const isValid = await this.awpPendingStore.validateCode(
        parsed.data.pubkey,
        parsed.data.verification_code
      );
      if (!isValid) {
        return errorResponse(400, "Invalid or expired verification code");
      }

      // Get pending auth to retrieve client name
      const pending = await this.awpPendingStore.get(parsed.data.pubkey);
      if (!pending) {
        return errorResponse(400, "Pending authorization not found");
      }

      // Store authorized pubkey
      const now = Date.now();
      const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

      await this.awpPubkeyStore.store({
        pubkey: parsed.data.pubkey,
        userId: auth.userId,
        clientName: pending.clientName,
        createdAt: now,
        expiresAt,
      });

      // Clean up pending auth
      await this.awpPendingStore.delete(parsed.data.pubkey);

      return jsonResponse(200, {
        success: true,
        expires_at: expiresAt,
      });
    }

    // Routes requiring auth
    const auth = await this.authMiddleware.authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }

    // GET /auth/agent-tokens/clients - List authorized AWP clients
    if (req.method === "GET" && path === "/agent-tokens/clients") {
      const clients = await this.awpPubkeyStore.listByUser(auth.userId);
      return jsonResponse(200, {
        clients: clients.map((c) => ({
          pubkey: c.pubkey,
          clientName: c.clientName,
          createdAt: new Date(c.createdAt).toISOString(),
          expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
        })),
      });
    }

    // DELETE /auth/agent-tokens/clients/:pubkey - Revoke AWP client
    const clientRevokeMatch = path.match(/^\/agent-tokens\/clients\/(.+)$/);
    if (req.method === "DELETE" && clientRevokeMatch) {
      const pubkey = decodeURIComponent(clientRevokeMatch[1]!);

      // Verify ownership
      const client = await this.awpPubkeyStore.lookup(pubkey);
      if (!client || client.userId !== auth.userId) {
        return errorResponse(404, "Client not found or access denied");
      }

      await this.awpPubkeyStore.revoke(pubkey);
      return jsonResponse(200, { success: true });
    }

    // POST /auth/ticket
    if (req.method === "POST" && path === "/ticket") {
      const body = this.parseJson(req);
      const parsed = CreateTicketSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const result = await this.authService.createTicket(auth, parsed.data);
        return jsonResponse(201, result);
      } catch (error: any) {
        return errorResponse(403, error.message ?? "Cannot create ticket");
      }
    }

    // DELETE /auth/ticket/:id
    const ticketMatch = path.match(/^\/ticket\/([^\/]+)$/);
    if (req.method === "DELETE" && ticketMatch) {
      const ticketId = ticketMatch[1]!;
      try {
        await this.authService.revokeTicket(auth, ticketId);
        return jsonResponse(200, { success: true });
      } catch (error: any) {
        return errorResponse(404, error.message ?? "Ticket not found");
      }
    }

    return errorResponse(404, "Auth endpoint not found");
  }

  // ============================================================================
  // CAS Routes
  // ============================================================================

  private async handleCas(req: HttpRequest): Promise<HttpResponse> {
    // Parse path: /cas/{scope}/...
    const casMatch = req.path.match(/^\/cas\/([^\/]+)(.*)$/);
    if (!casMatch) {
      return errorResponse(404, "Invalid CAS path");
    }

    const requestedScope = casMatch[1]!;
    const subPath = casMatch[2] ?? "";

    // Authenticate
    const auth = await this.authMiddleware.authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }

    // Check scope access
    if (!this.authMiddleware.checkScopeAccess(auth, requestedScope)) {
      return errorResponse(403, "Access denied to this scope");
    }

    const scope = this.authMiddleware.resolveScope(auth, requestedScope);

    // POST /cas/{scope}/resolve
    if (req.method === "POST" && subPath === "/resolve") {
      return this.handleResolve(auth, scope, req);
    }

    // PUT /cas/{scope}/node/:key
    const putNodeMatch = subPath.match(/^\/node\/(.+)$/);
    if (req.method === "PUT" && putNodeMatch) {
      const key = decodeURIComponent(putNodeMatch[1]!);
      return this.handlePutNode(auth, scope, key, req);
    }

    // GET /cas/{scope}/node/:key
    const getNodeMatch = subPath.match(/^\/node\/(.+)$/);
    if (req.method === "GET" && getNodeMatch) {
      const key = decodeURIComponent(getNodeMatch[1]!);
      return this.handleGetNode(auth, scope, key);
    }

    // GET /cas/{scope}/dag/:key
    const getDagMatch = subPath.match(/^\/dag\/(.+)$/);
    if (req.method === "GET" && getDagMatch) {
      const key = decodeURIComponent(getDagMatch[1]!);
      return this.handleGetDag(auth, scope, key);
    }

    // POST /cas/{scope}/dag (multipart upload)
    if (req.method === "POST" && subPath === "/dag") {
      return this.handlePostDag(auth, scope, req);
    }

    return errorResponse(404, "CAS endpoint not found");
  }

  /**
   * POST /cas/{scope}/resolve
   */
  private async handleResolve(
    auth: AuthContext,
    scope: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    const body = this.parseJson(req);
    const parsed = ResolveSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const { nodes } = parsed.data;

    // Check which nodes exist in this scope
    const { missing } = await this.ownershipDb.checkOwnership(scope, nodes);

    return jsonResponse(200, { missing });
  }

  /**
   * PUT /cas/{scope}/node/:key
   */
  private async handlePutNode(
    auth: AuthContext,
    scope: string,
    key: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkWriteAccess(auth)) {
      return errorResponse(403, "Write access denied");
    }

    // Get binary content
    const content = this.getBinaryBody(req);
    if (!content || content.length === 0) {
      return errorResponse(400, "Empty body");
    }

    const contentType =
      req.headers["content-type"] ??
      req.headers["Content-Type"] ??
      "application/octet-stream";

    // Store with hash validation
    const result = await this.casStorage.putWithKey(key, content, contentType);

    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    // Add ownership record
    const tokenId = TokensDb.extractTokenId(auth.token.pk);
    await this.ownershipDb.addOwnership(
      scope,
      result.key,
      tokenId,
      contentType,
      result.size
    );

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
      contentType,
    });
  }

  /**
   * GET /cas/{scope}/node/:key
   */
  private async handleGetNode(
    auth: AuthContext,
    scope: string,
    key: string
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkReadAccess(auth, key)) {
      return errorResponse(403, "Read access denied");
    }

    // Check ownership
    const hasAccess = await this.ownershipDb.hasOwnership(scope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    // Get content from S3
    const result = await this.casStorage.get(key);
    if (!result) {
      return errorResponse(404, "Content not found in storage");
    }

    return binaryResponse(result.content, result.contentType, key);
  }

  /**
   * GET /cas/{scope}/dag/:key
   */
  private async handleGetDag(
    auth: AuthContext,
    scope: string,
    key: string
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkReadAccess(auth, key)) {
      return errorResponse(403, "Read access denied");
    }

    // Check ownership of root
    const hasAccess = await this.ownershipDb.hasOwnership(scope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    // Collect all DAG nodes
    const dagKeys = await this.dagDb.collectDagKeys(key);

    // For now, return a simple JSON manifest
    // TODO: Implement tar streaming
    const nodes: Record<string, { size: number; contentType: string; children: string[] }> = {};

    for (const nodeKey of dagKeys) {
      const meta = await this.dagDb.getNode(nodeKey);
      if (meta) {
        nodes[nodeKey] = {
          size: meta.size,
          contentType: meta.contentType,
          children: meta.children,
        };
      }
    }

    return jsonResponse(200, {
      root: key,
      nodes,
    });
  }

  /**
   * POST /cas/{scope}/dag (multipart upload)
   */
  private async handlePostDag(
    auth: AuthContext,
    scope: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkWriteAccess(auth)) {
      return errorResponse(403, "Write access denied");
    }

    // TODO: Implement multipart parsing with busboy
    // For now, return not implemented
    return errorResponse(501, "Multipart DAG upload not yet implemented");
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private parseJson(req: HttpRequest): unknown {
    if (!req.body) return {};

    const bodyStr =
      typeof req.body === "string"
        ? req.body
        : req.isBase64Encoded
          ? Buffer.from(req.body.toString(), "base64").toString("utf-8")
          : req.body.toString("utf-8");

    try {
      return JSON.parse(bodyStr);
    } catch {
      return {};
    }
  }

  private getBinaryBody(req: HttpRequest): Buffer {
    if (!req.body) return Buffer.alloc(0);

    if (Buffer.isBuffer(req.body)) {
      return req.isBase64Encoded
        ? Buffer.from(req.body.toString(), "base64")
        : req.body;
    }

    if (typeof req.body === "string") {
      return req.isBase64Encoded
        ? Buffer.from(req.body, "base64")
        : Buffer.from(req.body, "utf-8");
    }

    return Buffer.alloc(0);
  }
}
