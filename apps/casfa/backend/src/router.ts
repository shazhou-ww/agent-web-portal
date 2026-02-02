/**
 * CAS Stack - HTTP Router
 */

import { generateVerificationCode } from "@agent-web-portal/auth";
import {
  decodeNode,
  EMPTY_COLLECTION_BYTES,
  EMPTY_COLLECTION_KEY,
  validateNode,
  validateNodeStructure,
} from "@agent-web-portal/cas-core";
import { z } from "zod";
import { getCognitoUserMap } from "./auth/cognito-users.ts";
import { AuthService } from "./auth/service.ts";
import { NodeHashProvider, S3StorageProvider } from "./cas/providers.ts";
import { CasStorage } from "./cas/storage.ts";
import {
  AwpPendingAuthStore,
  AwpPubkeyStore,
  CommitsDb,
  DepotDb,
  MAIN_DEPOT_NAME,
  OwnershipDb,
  TokensDb,
  UserRolesDb,
} from "./db/index.ts";
import { RefCountDb } from "./db/refcount.ts";
import { UsageDb } from "./db/usage.ts";
import { McpHandler } from "./mcp/handler.ts";
import { AuthMiddleware } from "./middleware/auth.ts";
import type {
  AuthContext,
  CasConfig,
  CasEndpointInfo,
  HttpRequest,
  HttpResponse,
  TreeNodeInfo,
  TreeResponse,
} from "./types.ts";
import { CAS_CONTENT_TYPES, loadServerConfig } from "./types.ts";

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

// CreateTicketSchema - new format with scope/commit
const CreateTicketSchema = z.object({
  // Readable scope - undefined means full read access
  scope: z.array(z.string()).optional(),
  // Commit permission - undefined means read-only
  commit: z
    .object({
      quota: z.number().positive().optional(),
      accept: z.array(z.string()).optional(),
    })
    .optional(),
  expiresIn: z.number().positive().optional(),
});

// Commit schema - simplified: just root and optional title
// All nodes (chunks, collections) must be uploaded via PUT /chunks/:key first
const CommitSchema = z.object({
  root: z.string().regex(/^sha256:[a-f0-9]{64}$/, "Invalid root key format"),
  title: z.string().max(500).optional(),
});

// Update commit title schema
const UpdateCommitSchema = z.object({
  title: z.string().optional(),
});

// Depot schemas
const CreateDepotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

const UpdateDepotSchema = z.object({
  root: z.string().regex(/^sha256:[a-f0-9]{64}$/, "Invalid root key format"),
  message: z.string().max(500).optional(),
});

const RollbackDepotSchema = z.object({
  version: z.number().int().positive(),
});

// Agent Token schema
const CreateAgentTokenSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresIn: z.number().positive().optional(),
});

// User authorize schema (admin only)
const AuthorizeUserSchema = z.object({
  role: z.enum(["authorized", "admin"]),
});

// ============================================================================
// Response Helpers
// ============================================================================

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
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

function _binaryResponse(content: Buffer, contentType: string, casKey?: string): HttpResponse {
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
  private userRolesDb: UserRolesDb;
  private ownershipDb: OwnershipDb;
  private commitsDb: CommitsDb;
  private depotDb: DepotDb;
  private refCountDb: RefCountDb;
  private usageDb: UsageDb;
  private awpPendingStore: AwpPendingAuthStore;
  private awpPubkeyStore: AwpPubkeyStore;
  private mcpHandler: McpHandler;
  // CAS-core providers for binary format validation
  private hashProvider: NodeHashProvider;
  private storageProvider: S3StorageProvider;

  constructor(config: CasConfig) {
    this.config = config;
    this.tokensDb = new TokensDb(config);
    this.userRolesDb = new UserRolesDb(config);
    this.ownershipDb = new OwnershipDb(config);
    this.commitsDb = new CommitsDb(config);
    this.depotDb = new DepotDb(config);
    this.refCountDb = new RefCountDb(config);
    this.usageDb = new UsageDb(config);
    this.awpPendingStore = new AwpPendingAuthStore(config);
    this.awpPubkeyStore = new AwpPubkeyStore(config);
    this.authMiddleware = new AuthMiddleware(
      config,
      this.tokensDb,
      this.awpPubkeyStore,
      this.userRolesDb
    );
    this.authService = new AuthService(config, this.tokensDb, this.userRolesDb);
    this.casStorage = new CasStorage(config);
    this.mcpHandler = new McpHandler(config, loadServerConfig());
    // Initialize cas-core providers
    this.hashProvider = new NodeHashProvider();
    this.storageProvider = new S3StorageProvider({ bucket: config.casBucket });
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
      // All API routes under /api prefix
      if (!req.path.startsWith("/api/")) {
        return errorResponse(404, "Not found");
      }

      // Strip /api prefix for internal routing
      const apiPath = req.path.slice(4); // Remove "/api"

      // Health check
      if (apiPath === "/health" && req.method === "GET") {
        return jsonResponse(200, { status: "ok", service: "casfa" });
      }

      // OAuth routes (login/authentication - no auth required for most)
      if (apiPath.startsWith("/oauth/")) {
        return this.handleOAuth({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      // Auth routes (authorization - client management, tokens, tickets)
      // Preserve originalPath for signature verification
      if (apiPath.startsWith("/auth/")) {
        return this.handleAuth({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      // Admin routes (user management - admin only)
      if (apiPath.startsWith("/admin/")) {
        return this.handleAdmin({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      // MCP endpoint (requires Agent Token auth)
      if (apiPath === "/mcp" && req.method === "POST") {
        return this.handleMcp({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      // Realm routes (requires Authorization header)
      if (apiPath.startsWith("/realm/")) {
        return this.handleRealm({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      // Ticket routes (ticket ID in path is the credential, no header needed)
      if (apiPath.startsWith("/ticket/")) {
        return this.handleTicket({
          ...req,
          path: apiPath,
          originalPath: req.originalPath ?? req.path,
        });
      }

      return errorResponse(404, "Not found");
    } catch (error: any) {
      console.error("Router error:", error);
      return errorResponse(500, error.message ?? "Internal server error");
    }
  }

  // ============================================================================
  // MCP Route
  // ============================================================================

  private async handleMcp(req: HttpRequest): Promise<HttpResponse> {
    // Authenticate - prefer Agent Token but allow User Token too
    const auth = await this.authMiddleware.authenticate(req);
    if (!auth) {
      return errorResponse(401, "Authentication required. Use Agent Token or User Token.");
    }

    // Must have ticket issuing capability
    if (!auth.canIssueTicket) {
      return errorResponse(403, "Agent or User token required for MCP access");
    }

    return this.mcpHandler.handle(req, auth);
  }

  // ============================================================================
  // OAuth Routes (Login/Authentication)
  // ============================================================================

  private async handleOAuth(req: HttpRequest): Promise<HttpResponse> {
    const path = req.path.replace("/oauth", "");

    // GET /oauth/config - Public Cognito config for frontend (no auth)
    if (req.method === "GET" && path === "/config") {
      const { cognitoUserPoolId, cognitoClientId, cognitoHostedUiUrl } = this.config;
      return jsonResponse(200, {
        cognitoUserPoolId: cognitoUserPoolId ?? "",
        cognitoClientId: cognitoClientId ?? "",
        cognitoHostedUiUrl: cognitoHostedUiUrl ?? "",
      });
    }

    // POST /oauth/token - Exchange authorization code for tokens (Cognito Hosted UI / Google sign-in)
    if (req.method === "POST" && path === "/token") {
      const { cognitoHostedUiUrl, cognitoClientId } = this.config;
      if (!cognitoHostedUiUrl || !cognitoClientId) {
        return errorResponse(
          503,
          "OAuth / Google sign-in not configured (missing Hosted UI URL or Client ID)"
        );
      }
      const body = this.parseJson(req) as { code?: string; redirect_uri?: string };
      if (!body?.code || !body?.redirect_uri) {
        return errorResponse(400, "Missing code or redirect_uri");
      }
      const tokenBody = new URLSearchParams({
        grant_type: "authorization_code",
        client_id: cognitoClientId,
        code: body.code,
        redirect_uri: body.redirect_uri,
      });
      const tokenRes = await fetch(`${cognitoHostedUiUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: tokenBody.toString(),
      });
      const text = await tokenRes.text();
      if (!tokenRes.ok) {
        console.error("[OAuth] Token exchange failed:", tokenRes.status, text);
        return jsonResponse(tokenRes.status, { error: "Token exchange failed", details: text });
      }
      let data: unknown;
      try {
        data = JSON.parse(text);
      } catch {
        return errorResponse(502, "Invalid token response from Cognito");
      }
      return jsonResponse(200, data);
    }

    // POST /oauth/login
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

    // POST /oauth/refresh
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

    // GET /oauth/me - Current user info and role (requires auth)
    if (req.method === "GET" && path === "/me") {
      const auth = await this.authMiddleware.authenticate(req);
      if (!auth) {
        return errorResponse(401, "Unauthorized");
      }
      return jsonResponse(200, {
        userId: auth.userId,
        realm: auth.realm,
        role: auth.role ?? "unauthorized",
      });
    }

    return errorResponse(404, "OAuth endpoint not found");
  }

  // ============================================================================
  // Auth Routes (Authorization - Client management, tokens, tickets)
  // ============================================================================

  private async handleAuth(req: HttpRequest): Promise<HttpResponse> {
    const path = req.path.replace("/auth", "");

    // ========================================================================
    // AWP Client Routes (P256 public key authorization)
    // ========================================================================

    // POST /auth/clients/init - Start AWP auth flow (no auth required)
    if (req.method === "POST" && path === "/clients/init") {
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

    // GET /auth/clients/status - Poll for auth completion (no auth required)
    if (req.method === "GET" && path === "/clients/status") {
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

    // POST /auth/clients/complete - Complete authorization (requires user auth)
    if (req.method === "POST" && path === "/clients/complete") {
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

    // GET /auth/clients - List authorized AWP clients
    if (req.method === "GET" && path === "/clients") {
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

    // DELETE /auth/clients/:pubkey - Revoke AWP client
    const clientRevokeMatch = path.match(/^\/clients\/(.+)$/);
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

    // ========================================================================
    // Ticket Routes
    // ========================================================================

    // POST /auth/ticket
    if (req.method === "POST" && path === "/ticket") {
      const body = this.parseJson(req);
      const parsed = CreateTicketSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const serverConfig = loadServerConfig();
        const ticket = await this.tokensDb.createTicket(
          auth.realm,
          TokensDb.extractTokenId(auth.token.pk),
          parsed.data.scope,
          parsed.data.commit,
          parsed.data.expiresIn
        );

        const ticketId = TokensDb.extractTokenId(ticket.pk);
        // Build endpoint URL - ticket ID is the credential
        const endpoint = `${serverConfig.baseUrl}/api/ticket/${ticketId}`;

        return jsonResponse(201, {
          id: ticketId,
          endpoint,
          expiresAt: new Date(ticket.expiresAt).toISOString(),
          realm: ticket.realm,
          scope: ticket.scope,
          commit: ticket.commit,
          config: ticket.config,
        });
      } catch (error: any) {
        return errorResponse(403, error.message ?? "Cannot create ticket");
      }
    }

    // DELETE /auth/ticket/:id
    const ticketMatch = path.match(/^\/ticket\/([^/]+)$/);
    if (req.method === "DELETE" && ticketMatch) {
      const ticketId = ticketMatch[1]!;
      try {
        await this.authService.revokeTicket(auth, ticketId);
        return jsonResponse(200, { success: true });
      } catch (error: any) {
        return errorResponse(404, error.message ?? "Ticket not found");
      }
    }

    // ========================================================================
    // Agent Token Management Routes
    // ========================================================================

    // POST /auth/tokens - Create agent token
    if (req.method === "POST" && path === "/tokens") {
      const body = this.parseJson(req);
      console.log("[CAS] Create agent token - body:", JSON.stringify(body));
      const parsed = CreateAgentTokenSchema.safeParse(body);
      if (!parsed.success) {
        console.log("[CAS] Validation failed:", JSON.stringify(parsed.error.issues));
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }

      try {
        const serverConfig = loadServerConfig();
        const token = await this.tokensDb.createAgentToken(
          auth.userId,
          parsed.data.name,
          serverConfig,
          {
            description: parsed.data.description,
            expiresIn: parsed.data.expiresIn,
          }
        );

        const tokenId = TokensDb.extractTokenId(token.pk);
        return jsonResponse(201, {
          id: tokenId,
          name: token.name,
          description: token.description,
          expiresAt: new Date(token.expiresAt).toISOString(),
          createdAt: new Date(token.createdAt).toISOString(),
        });
      } catch (error: any) {
        return errorResponse(403, error.message ?? "Cannot create agent token");
      }
    }

    // GET /auth/tokens - List agent tokens
    if (req.method === "GET" && path === "/tokens") {
      const tokens = await this.tokensDb.listAgentTokensByUser(auth.userId);
      return jsonResponse(200, {
        tokens: tokens.map((t) => ({
          id: TokensDb.extractTokenId(t.pk),
          name: t.name,
          description: t.description,
          expiresAt: new Date(t.expiresAt).toISOString(),
          createdAt: new Date(t.createdAt).toISOString(),
        })),
      });
    }

    // DELETE /auth/tokens/:id - Revoke agent token
    const agentTokenMatch = path.match(/^\/tokens\/([^/]+)$/);
    if (req.method === "DELETE" && agentTokenMatch) {
      const tokenId = agentTokenMatch[1]!;
      try {
        await this.tokensDb.revokeAgentToken(auth.userId, tokenId);
        return jsonResponse(200, { success: true });
      } catch (error: any) {
        return errorResponse(404, error.message ?? "Agent token not found");
      }
    }

    return errorResponse(404, "Auth endpoint not found");
  }

  // ============================================================================
  // Admin Routes (User management - admin only)
  // ============================================================================

  private async handleAdmin(req: HttpRequest): Promise<HttpResponse> {
    const auth = await this.authMiddleware.authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }
    if (!auth.canManageUsers) {
      return errorResponse(403, "Admin access required");
    }

    const path = req.path.replace("/admin", "");

    // GET /admin/users - List users with roles, enriched with email/name from Cognito
    if (req.method === "GET" && path === "/users") {
      const list = await this.userRolesDb.listRoles();
      const cognitoMap = await getCognitoUserMap(
        this.config.cognitoUserPoolId,
        this.config.cognitoRegion
      );
      const users = list.map((u) => {
        const attrs = cognitoMap.get(u.userId);
        return {
          userId: u.userId,
          role: u.role,
          email: attrs?.email ?? "",
          name: attrs?.name ?? undefined,
        };
      });
      return jsonResponse(200, { users });
    }

    // POST /admin/users/:userId/authorize - Set user role
    const authorizePostMatch = path.match(/^\/users\/([^/]+)\/authorize$/);
    if (req.method === "POST" && authorizePostMatch) {
      const targetUserId = decodeURIComponent(authorizePostMatch[1]!);
      const body = this.parseJson(req);
      const parsed = AuthorizeUserSchema.safeParse(body);
      if (!parsed.success) {
        return errorResponse(400, "Invalid request", parsed.error.issues);
      }
      await this.userRolesDb.setRole(targetUserId, parsed.data.role);
      return jsonResponse(200, { userId: targetUserId, role: parsed.data.role });
    }

    // DELETE /admin/users/:userId/authorize - Revoke user
    const authorizeDeleteMatch = path.match(/^\/users\/([^/]+)\/authorize$/);
    if (req.method === "DELETE" && authorizeDeleteMatch) {
      const targetUserId = decodeURIComponent(authorizeDeleteMatch[1]!);
      await this.userRolesDb.revoke(targetUserId);
      return jsonResponse(200, { userId: targetUserId, revoked: true });
    }

    return errorResponse(404, "Admin endpoint not found");
  }

  // ============================================================================
  // Realm Routes (requires Authorization header)
  // ============================================================================

  private async handleRealm(req: HttpRequest): Promise<HttpResponse> {
    // Parse path: /realm/{realmId}/...
    const realmMatch = req.path.match(/^\/realm\/([^/]+)(.*)$/);
    if (!realmMatch) {
      return errorResponse(404, "Invalid realm path");
    }

    const realmId = realmMatch[1]!;
    const subPath = realmMatch[2] ?? "";

    // Authenticate - requires Authorization header
    const auth = await this.authMiddleware.authenticate(req);
    if (!auth) {
      return errorResponse(401, "Authorization required");
    }

    // Check realm access - user can only access their own realm
    if (!this.authMiddleware.checkRealmAccess(auth, realmId)) {
      return errorResponse(403, "Access denied to this realm");
    }

    // GET /realm/{realmId} - Return endpoint info
    if (req.method === "GET" && subPath === "") {
      return this.handleGetRealmInfo(auth, realmId);
    }

    return this.handleCasOperations(auth, realmId, subPath, req);
  }

  // ============================================================================
  // Ticket Routes (ticket ID in path is the credential)
  // ============================================================================

  private async handleTicket(req: HttpRequest): Promise<HttpResponse> {
    // Parse path: /ticket/{ticketId}/...
    const ticketMatch = req.path.match(/^\/ticket\/([^/]+)(.*)$/);
    if (!ticketMatch) {
      return errorResponse(404, "Invalid ticket path");
    }

    const ticketId = ticketMatch[1]!;
    const subPath = ticketMatch[2] ?? "";

    // GET /ticket/{ticketId} - Return endpoint info (no auth header needed)
    if (req.method === "GET" && subPath === "") {
      return this.handleGetTicketInfo(ticketId);
    }

    // Authenticate by ticket ID - no header needed, ticket ID is the credential
    const auth = await this.authMiddleware.authenticateByTicketId(ticketId);
    if (!auth) {
      return errorResponse(401, "Invalid or expired ticket");
    }

    // Use the ticket's realm for operations
    const realm = auth.realm;

    return this.handleCasOperations(auth, realm, subPath, req);
  }

  // ============================================================================
  // Shared CAS Operations
  // ============================================================================

  private async handleCasOperations(
    auth: AuthContext,
    realm: string,
    subPath: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    // POST /commit - Create nodes and record commit (replaces PUT /file and PUT /collection)
    if (req.method === "POST" && subPath === "/commit") {
      return this.handleCommit(auth, realm, req);
    }

    // GET /commits - List commits for realm
    if (req.method === "GET" && subPath === "/commits") {
      return this.handleListCommits(auth, realm, req);
    }

    // GET /usage - Get realm usage statistics
    if (req.method === "GET" && subPath === "/usage") {
      return this.handleGetUsage(auth, realm);
    }

    // GET /commits/:root - Get commit details
    const getCommitMatch = subPath.match(/^\/commits\/(.+)$/);
    if (req.method === "GET" && getCommitMatch) {
      const root = decodeURIComponent(getCommitMatch[1]!);
      return this.handleGetCommit(auth, realm, root);
    }

    // PATCH /commits/:root - Update commit metadata
    const patchCommitMatch = subPath.match(/^\/commits\/(.+)$/);
    if (req.method === "PATCH" && patchCommitMatch) {
      const root = decodeURIComponent(patchCommitMatch[1]!);
      return this.handleUpdateCommit(auth, realm, root, req);
    }

    // DELETE /commits/:root - Delete commit record
    const deleteCommitMatch = subPath.match(/^\/commits\/(.+)$/);
    if (req.method === "DELETE" && deleteCommitMatch) {
      const root = decodeURIComponent(deleteCommitMatch[1]!);
      return this.handleDeleteCommit(auth, realm, root);
    }

    // PUT /chunks/:key - Upload CAS node (binary format with cas-core validation)
    const putChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
    if (req.method === "PUT" && putChunkMatch) {
      const key = decodeURIComponent(putChunkMatch[1]!);
      return this.handlePutChunk(auth, realm, key, req);
    }

    // GET /chunks/:key - Get raw node data (binary)
    const getChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
    if (req.method === "GET" && getChunkMatch) {
      const key = decodeURIComponent(getChunkMatch[1]!);
      return this.handleGetChunk(auth, realm, key);
    }

    // GET /tree/:key - Get complete DAG structure
    const getTreeMatch = subPath.match(/^\/tree\/(.+)$/);
    if (req.method === "GET" && getTreeMatch) {
      const key = decodeURIComponent(getTreeMatch[1]!);
      return this.handleGetTree(auth, realm, key);
    }

    // ========================================================================
    // Depot Routes
    // ========================================================================

    // GET /depots - List all depots
    if (req.method === "GET" && subPath === "/depots") {
      return this.handleListDepots(auth, realm, req);
    }

    // POST /depots - Create a new depot
    if (req.method === "POST" && subPath === "/depots") {
      return this.handleCreateDepot(auth, realm, req);
    }

    // GET /depots/:depotId - Get depot by ID
    const getDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
    if (req.method === "GET" && getDepotMatch) {
      const depotId = decodeURIComponent(getDepotMatch[1]!);
      return this.handleGetDepot(auth, realm, depotId);
    }

    // PUT /depots/:depotId - Update depot root
    const putDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
    if (req.method === "PUT" && putDepotMatch) {
      const depotId = decodeURIComponent(putDepotMatch[1]!);
      return this.handleUpdateDepot(auth, realm, depotId, req);
    }

    // DELETE /depots/:depotId - Delete depot
    const deleteDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
    if (req.method === "DELETE" && deleteDepotMatch) {
      const depotId = decodeURIComponent(deleteDepotMatch[1]!);
      return this.handleDeleteDepot(auth, realm, depotId);
    }

    // GET /depots/:depotId/history - List depot history
    const getHistoryMatch = subPath.match(/^\/depots\/([^/]+)\/history$/);
    if (req.method === "GET" && getHistoryMatch) {
      const depotId = decodeURIComponent(getHistoryMatch[1]!);
      return this.handleListDepotHistory(auth, realm, depotId, req);
    }

    // POST /depots/:depotId/rollback - Rollback to a previous version
    const rollbackMatch = subPath.match(/^\/depots\/([^/]+)\/rollback$/);
    if (req.method === "POST" && rollbackMatch) {
      const depotId = decodeURIComponent(rollbackMatch[1]!);
      return this.handleRollbackDepot(auth, realm, depotId, req);
    }

    return errorResponse(404, "Endpoint not found");
  }

  /**
   * GET /realm/{realmId} - Return endpoint info for user realm
   */
  private handleGetRealmInfo(auth: AuthContext, realmId: string): HttpResponse {
    const serverConfig = loadServerConfig();

    const info: CasEndpointInfo = {
      realm: realmId,
      // User/Agent tokens have full access, no scope restriction
      scope: undefined,
      // User/Agent tokens can always commit
      commit: auth.canWrite ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    };

    return jsonResponse(200, info);
  }

  /**
   * GET /usage - Return realm usage statistics
   */
  private async handleGetUsage(auth: AuthContext, realm: string): Promise<HttpResponse> {
    const usage = await this.usageDb.getUsage(realm);

    return jsonResponse(200, {
      realm: usage.realm,
      physicalBytes: usage.physicalBytes,
      logicalBytes: usage.logicalBytes,
      nodeCount: usage.nodeCount,
      quotaLimit: usage.quotaLimit,
      updatedAt: usage.updatedAt ? new Date(usage.updatedAt).toISOString() : null,
    });
  }

  /**
   * GET /ticket/{ticketId} - Return endpoint info for ticket
   * No auth header needed - ticket ID is the credential
   */
  private async handleGetTicketInfo(ticketId: string): Promise<HttpResponse> {
    const ticket = await this.tokensDb.getTicket(ticketId);

    if (!ticket) {
      return errorResponse(404, "Ticket not found");
    }

    if (ticket.expiresAt < Date.now()) {
      return errorResponse(410, "Ticket expired");
    }

    const info: CasEndpointInfo = {
      realm: ticket.realm,
      scope: ticket.scope,
      commit: ticket.commit,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      nodeLimit: ticket.config.nodeLimit,
      maxNameBytes: ticket.config.maxNameBytes,
    };

    return jsonResponse(200, info);
  }

  /**
   * POST /commit - Record a commit pointing to an existing root node
   *
   * Request body:
   * {
   *   root: string,           // Required: top-level node key (must exist via PUT /chunks/:key)
   *   title?: string,         // Optional: user-visible title
   * }
   *
   * Response (success):
   * { success: true, root: string }
   *
   * Response (root not found):
   * { success: false, error: "root_not_found" }
   */
  private async handleCommit(
    auth: AuthContext,
    realm: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkWriteAccess(auth)) {
      return errorResponse(403, "Write access denied");
    }

    const body = this.parseJson(req);
    const parsed = CommitSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const { root, title } = parsed.data;
    const tokenId = TokensDb.extractTokenId(auth.token.pk);

    // Verify root exists in storage
    const rootExists = await this.storageProvider.has(root);
    if (!rootExists) {
      return jsonResponse(200, {
        success: false,
        error: "root_not_found",
        message: `Root node ${root} not found. Upload it via PUT /chunks/${root} first.`,
      });
    }

    // Verify ownership (root must be owned by this realm)
    const hasOwnership = await this.ownershipDb.hasOwnership(realm, root);
    if (!hasOwnership) {
      return errorResponse(403, "Root node not owned by this realm");
    }

    // Increment reference count for root (commit references root)
    const rootRef = await this.refCountDb.getRefCount(realm, root);
    if (rootRef) {
      await this.refCountDb.incrementRef(realm, root, rootRef.physicalSize, rootRef.logicalSize);
    }

    // Record commit
    await this.commitsDb.create(realm, root, tokenId, title);

    // Mark ticket as committed if applicable
    if (auth.token.type === "ticket") {
      const ticketId = TokensDb.extractTokenId(auth.token.pk);
      const marked = await this.tokensDb.markTicketCommitted(ticketId, root);
      if (!marked) {
        return errorResponse(403, "Ticket already committed");
      }
    }

    return jsonResponse(200, {
      success: true,
      root,
    });
  }

  /**
   * GET /commits - List commits for realm
   */
  private async handleListCommits(
    auth: AuthContext,
    realm: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    const url = new URL(req.path, "http://localhost");
    const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "100", 10), 1000);
    const startKey = url.searchParams.get("startKey") ?? undefined;

    const result = await this.commitsDb.listByScan(realm, { limit, startKey });

    return jsonResponse(200, {
      commits: result.commits.map((c) => ({
        root: c.root,
        title: c.title,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
      nextKey: result.nextKey,
    });
  }

  /**
   * GET /commits/:root - Get commit details
   */
  private async handleGetCommit(
    auth: AuthContext,
    realm: string,
    root: string
  ): Promise<HttpResponse> {
    const commit = await this.commitsDb.get(realm, root);
    if (!commit) {
      return errorResponse(404, "Commit not found");
    }

    return jsonResponse(200, {
      root: commit.root,
      title: commit.title,
      createdAt: new Date(commit.createdAt).toISOString(),
      createdBy: commit.createdBy,
    });
  }

  /**
   * PATCH /commits/:root - Update commit metadata
   */
  private async handleUpdateCommit(
    auth: AuthContext,
    realm: string,
    root: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkWriteAccess(auth)) {
      return errorResponse(403, "Write access denied");
    }

    const body = this.parseJson(req);
    const parsed = UpdateCommitSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const commit = await this.commitsDb.update(realm, root, { title: parsed.data.title });
    if (!commit) {
      return errorResponse(404, "Commit not found");
    }

    return jsonResponse(200, {
      root: commit.root,
      title: commit.title,
      createdAt: new Date(commit.createdAt).toISOString(),
    });
  }

  /**
   * DELETE /commits/:root - Delete commit record
   *
   * Decrements reference count for the root node.
   * Does NOT recursively delete children - that's handled by GC.
   */
  private async handleDeleteCommit(
    auth: AuthContext,
    realm: string,
    root: string
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkWriteAccess(auth)) {
      return errorResponse(403, "Write access denied");
    }

    // First verify the commit exists
    const commit = await this.commitsDb.get(realm, root);
    if (!commit) {
      return errorResponse(404, "Commit not found");
    }

    // Decrement reference count for root (commit no longer references it)
    await this.refCountDb.decrementRef(realm, root);

    // Delete the commit record
    const deleted = await this.commitsDb.delete(realm, root);
    if (!deleted) {
      return errorResponse(404, "Commit not found");
    }

    return jsonResponse(200, { success: true });
  }

  /**
   * PUT /chunks/:key - Upload CAS node (binary format)
   *
   * Validates:
   * - Magic bytes and header structure
   * - Hash matches expected key
   * - All children exist in storage
   * - For collections: size equals sum of children sizes
   *
   * Tracks references and usage:
   * - Increments ref count for this node and its children
   * - Updates realm usage statistics
   * - Checks realm quota before storing
   */
  private async handlePutChunk(
    auth: AuthContext,
    realm: string,
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

    // Check ticket quota if applicable
    if (!this.authMiddleware.checkWritableQuota(auth, content.length)) {
      return errorResponse(413, "Quota exceeded", {
        error: "TICKET_QUOTA_EXCEEDED",
        message: "Upload size exceeds ticket quota",
      });
    }

    // Convert to Uint8Array for cas-core
    const bytes = new Uint8Array(content);

    // Quick structure validation first (no async, fast fail)
    const structureResult = validateNodeStructure(bytes);
    if (!structureResult.valid) {
      return errorResponse(400, "Invalid node structure", { error: structureResult.error });
    }

    // Helper to get child size from storage
    const getChildSize = async (childKey: string): Promise<number | null> => {
      const childData = await this.storageProvider.get(childKey);
      if (!childData) return null;
      try {
        const node = decodeNode(childData);
        return node.size;
      } catch {
        return null;
      }
    };

    // Full validation with hash check, children existence, and size validation
    const validationResult = await validateNode(
      bytes,
      key,
      this.hashProvider,
      (childKey) => this.storageProvider.has(childKey),
      structureResult.kind === "collection" ? getChildSize : undefined
    );

    if (!validationResult.valid) {
      // Check if it's a missing children error
      if (validationResult.error?.includes("Missing children")) {
        return jsonResponse(200, {
          success: false,
          error: "missing_nodes",
          missing:
            validationResult.childKeys?.filter(async (k) => !(await this.storageProvider.has(k))) ??
            [],
        });
      }
      return errorResponse(400, "Node validation failed", { error: validationResult.error });
    }

    // Calculate sizes for reference counting
    const physicalSize = bytes.length;
    // logicalSize is only for chunks (actual data), 0 for collections
    const logicalSize =
      structureResult.kind === "chunk" ? (validationResult.size ?? bytes.length) : 0;
    const childKeys = validationResult.childKeys ?? [];

    // Check realm quota before storing
    // Estimate new physical bytes (only count if this is new to realm)
    const existingRef = await this.refCountDb.getRefCount(realm, key);
    const estimatedNewBytes = existingRef ? 0 : physicalSize;

    if (estimatedNewBytes > 0) {
      const { allowed, usage } = await this.usageDb.checkQuota(realm, estimatedNewBytes);
      if (!allowed) {
        return errorResponse(403, "Realm quota exceeded", {
          error: "REALM_QUOTA_EXCEEDED",
          message: "Upload would exceed realm storage quota",
          details: {
            limit: usage.quotaLimit,
            used: usage.physicalBytes,
            requested: estimatedNewBytes,
          },
        });
      }
    }

    // Store the node
    await this.storageProvider.put(key, bytes);

    // Add ownership record (for backward compatibility)
    const tokenId = TokensDb.extractTokenId(auth.token.pk);
    await this.ownershipDb.addOwnership(
      realm,
      key,
      tokenId,
      "application/octet-stream", // Binary format
      validationResult.size ?? bytes.length,
      validationResult.kind ?? "chunk"
    );

    // Increment reference count for this node
    const { isNewToRealm } = await this.refCountDb.incrementRef(
      realm,
      key,
      physicalSize,
      logicalSize
    );

    // Increment reference count for all children
    for (const childKey of childKeys) {
      // Get child's physical/logical size from its existing ref record
      const childRef = await this.refCountDb.getRefCount(realm, childKey);
      if (childRef) {
        await this.refCountDb.incrementRef(
          realm,
          childKey,
          childRef.physicalSize,
          childRef.logicalSize
        );
      }
    }

    // Update realm usage if this is a new node to the realm
    if (isNewToRealm) {
      await this.usageDb.updateUsage(realm, {
        physicalBytes: physicalSize,
        logicalBytes: logicalSize,
        nodeCount: 1,
      });
    }

    return jsonResponse(200, {
      key,
      size: validationResult.size,
      kind: validationResult.kind,
    });
  }

  /**
   * GET /{realm}/tree/:key - Get complete DAG structure
   * Returns all file/inline-file/collection nodes in the tree rooted at key.
   * Limited to 1000 nodes per response; returns 'next' for continuation.
   */
  private async handleGetTree(
    auth: AuthContext,
    realm: string,
    rootKey: string
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkReadAccess(auth, rootKey)) {
      return errorResponse(403, "Read access denied");
    }

    // Check ownership of root
    const hasAccess = await this.ownershipDb.hasOwnership(realm, rootKey);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const MAX_NODES = 1000;
    const nodes: Record<string, TreeNodeInfo> = {};
    const queue: string[] = [rootKey]; // BFS queue (could use DFS for depth-first)
    let next: string | undefined;

    while (queue.length > 0) {
      if (Object.keys(nodes).length >= MAX_NODES) {
        // Truncate - return next node in queue for continuation
        next = queue[0];
        break;
      }

      const key = queue.shift()!;

      // Skip if already processed
      if (nodes[key]) continue;

      const result = await this.casStorage.get(key);
      if (!result) continue;

      const { content, contentType, metadata } = result;

      if (contentType === CAS_CONTENT_TYPES.COLLECTION) {
        // Collection: JSON body with children
        try {
          const data = JSON.parse(content.toString("utf-8"));
          const children = data.children as Record<string, string>;
          nodes[key] = {
            kind: "collection",
            size: metadata.casSize ?? content.length,
            children,
          };
          // Add children to queue
          for (const childKey of Object.values(children)) {
            if (!nodes[childKey]) {
              queue.push(childKey);
            }
          }
        } catch {
          // Invalid JSON, skip
        }
      } else if (contentType === CAS_CONTENT_TYPES.FILE) {
        // Multi-chunk file: binary body = chunk keys (N×32 bytes hex)
        const chunkCount = content.length / 64; // 64 hex chars per hash
        nodes[key] = {
          kind: "file",
          size: metadata.casSize ?? 0,
          contentType: metadata.casContentType,
          chunks: chunkCount,
        };
        // Chunks are not added to queue - client fetches via /raw
      } else if (contentType === CAS_CONTENT_TYPES.INLINE_FILE) {
        // Inline file: binary content directly
        nodes[key] = {
          kind: "inline-file",
          size: metadata.casSize ?? content.length,
          contentType: metadata.casContentType,
        };
      }
      // Chunks (application/octet-stream) are not included in tree response
    }

    const response: TreeResponse = { nodes };
    if (next) {
      response.next = next;
    }

    return jsonResponse(200, response);
  }

  /**
   * GET /chunks/:key - Get raw CAS node data (binary format)
   * Returns the binary blob directly
   */
  private async handleGetChunk(
    auth: AuthContext,
    realm: string,
    key: string
  ): Promise<HttpResponse> {
    if (!this.authMiddleware.checkReadAccess(auth, key)) {
      return errorResponse(403, "Read access denied");
    }

    // Check ownership
    const hasAccess = await this.ownershipDb.hasOwnership(realm, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    // Get content from S3 via cas-core provider
    const bytes = await this.storageProvider.get(key);
    if (!bytes) {
      return errorResponse(404, "Content not found in storage");
    }

    // Decode to get metadata for headers
    let kind: string | undefined;
    let size: number | undefined;
    let contentType: string | undefined;
    try {
      const node = decodeNode(bytes);
      kind = node.kind;
      size = node.size;
      contentType = node.contentType;
    } catch {
      // If decode fails, just return raw data
    }

    const headers: Record<string, string> = {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(bytes.length),
      ...CORS_HEADERS,
    };

    if (kind) {
      headers["X-CAS-Kind"] = kind;
    }
    if (size !== undefined) {
      headers["X-CAS-Size"] = String(size);
    }
    if (contentType) {
      headers["X-CAS-Content-Type"] = contentType;
    }

    return {
      statusCode: 200,
      headers,
      body: Buffer.from(bytes).toString("base64"),
      isBase64Encoded: true,
    };
  }

  // ============================================================================
  // Depot Handlers
  // ============================================================================

  /**
   * Ensure the empty collection exists in storage
   * This is called lazily when needed
   */
  private async ensureEmptyCollection(): Promise<void> {
    const exists = await this.casStorage.exists(EMPTY_COLLECTION_KEY);
    if (!exists) {
      const result = await this.casStorage.putWithKey(
        EMPTY_COLLECTION_KEY,
        Buffer.from(EMPTY_COLLECTION_BYTES),
        CAS_CONTENT_TYPES.COLLECTION
      );
      if ("error" in result) {
        throw new Error(
          `Empty collection hash mismatch: expected ${result.expected}, got ${result.actual}`
        );
      }
    }
  }

  /**
   * GET /depots - List all depots in realm
   */
  private async handleListDepots(
    auth: AuthContext,
    realm: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }

    const limit = parseInt(req.query.limit ?? "100", 10);
    const cursor = req.query.cursor;

    const result = await this.depotDb.list(realm, {
      limit,
      startKey: cursor,
    });

    return jsonResponse(200, {
      depots: result.depots.map((d) => ({
        depotId: d.depotId,
        name: d.name,
        root: d.root,
        version: d.version,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
        description: d.description,
      })),
      cursor: result.nextKey,
    });
  }

  /**
   * POST /depots - Create a new depot
   */
  private async handleCreateDepot(
    auth: AuthContext,
    realm: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }

    const body = this.parseJson(req);
    const parsed = CreateDepotSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const { name, description } = parsed.data;

    // Check if depot with this name already exists
    const existing = await this.depotDb.getByName(realm, name);
    if (existing) {
      return errorResponse(409, `Depot with name '${name}' already exists`);
    }

    // Ensure empty collection exists
    await this.ensureEmptyCollection();

    // Increment ref for empty collection
    await this.refCountDb.incrementRef(
      realm,
      EMPTY_COLLECTION_KEY,
      EMPTY_COLLECTION_BYTES.length,
      0
    );

    // Create the depot
    const depot = await this.depotDb.create(realm, {
      name,
      root: EMPTY_COLLECTION_KEY,
      description,
    });

    return jsonResponse(201, {
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  /**
   * GET /depots/:depotId - Get depot by ID
   */
  private async handleGetDepot(
    auth: AuthContext,
    realm: string,
    depotId: string
  ): Promise<HttpResponse> {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }

    const depot = await this.depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    return jsonResponse(200, {
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  /**
   * PUT /depots/:depotId - Update depot root
   */
  private async handleUpdateDepot(
    auth: AuthContext,
    realm: string,
    depotId: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }

    const body = this.parseJson(req);
    const parsed = UpdateDepotSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const { root: newRoot, message } = parsed.data;

    // Get current depot
    const depot = await this.depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const oldRoot = depot.root;

    // Verify new root exists
    const exists = await this.casStorage.exists(newRoot);
    if (!exists) {
      return errorResponse(400, "New root node does not exist");
    }

    // Get children of new root for ref counting
    const newRootResult = await this.casStorage.get(newRoot);
    if (!newRootResult) {
      return errorResponse(400, "Failed to read new root node");
    }

    const decoded = decodeNode(new Uint8Array(newRootResult.content));
    const physicalSize = newRootResult.content.length;
    const logicalSize = decoded.kind === "chunk" ? decoded.size : 0;

    // Increment ref for new root
    await this.refCountDb.incrementRef(realm, newRoot, physicalSize, logicalSize);

    // Decrement ref for old root
    await this.refCountDb.decrementRef(realm, oldRoot);

    // Update depot
    const { depot: updatedDepot } = await this.depotDb.updateRoot(realm, depotId, newRoot, message);

    return jsonResponse(200, {
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }

  /**
   * DELETE /depots/:depotId - Delete a depot
   */
  private async handleDeleteDepot(
    auth: AuthContext,
    realm: string,
    depotId: string
  ): Promise<HttpResponse> {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }

    // Get depot first to check if it exists and get root
    const depot = await this.depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    // Check if it's the main depot
    if (depot.name === MAIN_DEPOT_NAME) {
      return errorResponse(403, "Cannot delete the main depot");
    }

    // Decrement ref for current root
    await this.refCountDb.decrementRef(realm, depot.root);

    // Delete the depot
    await this.depotDb.delete(realm, depotId);

    return jsonResponse(200, { deleted: true });
  }

  /**
   * GET /depots/:depotId/history - List depot history
   */
  private async handleListDepotHistory(
    auth: AuthContext,
    realm: string,
    depotId: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }

    // Verify depot exists
    const depot = await this.depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const limit = parseInt(req.query.limit ?? "50", 10);
    const cursor = req.query.cursor;

    const result = await this.depotDb.listHistory(realm, depotId, {
      limit,
      startKey: cursor,
    });

    return jsonResponse(200, {
      history: result.history.map((h) => ({
        version: h.version,
        root: h.root,
        createdAt: new Date(h.createdAt).toISOString(),
        message: h.message,
      })),
      cursor: result.nextKey,
    });
  }

  /**
   * POST /depots/:depotId/rollback - Rollback to a previous version
   */
  private async handleRollbackDepot(
    auth: AuthContext,
    realm: string,
    depotId: string,
    req: HttpRequest
  ): Promise<HttpResponse> {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }

    const body = this.parseJson(req);
    const parsed = RollbackDepotSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(400, "Invalid request", parsed.error.issues);
    }

    const { version } = parsed.data;

    // Get current depot
    const depot = await this.depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    // Get the history record for target version
    const historyRecord = await this.depotDb.getHistory(realm, depotId, version);
    if (!historyRecord) {
      return errorResponse(404, `Version ${version} not found`);
    }

    const oldRoot = depot.root;
    const newRoot = historyRecord.root;

    // Skip if already at this root
    if (oldRoot === newRoot) {
      return jsonResponse(200, {
        depotId: depot.depotId,
        name: depot.name,
        root: depot.root,
        version: depot.version,
        createdAt: new Date(depot.createdAt).toISOString(),
        updatedAt: new Date(depot.updatedAt).toISOString(),
        description: depot.description,
        message: "Already at this version",
      });
    }

    // Get children of target root for ref counting
    const newRootResult = await this.casStorage.get(newRoot);
    if (!newRootResult) {
      return errorResponse(500, "Failed to read target root node");
    }

    const decoded = decodeNode(new Uint8Array(newRootResult.content));
    const physicalSize = newRootResult.content.length;
    const logicalSize = decoded.kind === "chunk" ? decoded.size : 0;

    // Increment ref for target root
    await this.refCountDb.incrementRef(realm, newRoot, physicalSize, logicalSize);

    // Decrement ref for old root
    await this.refCountDb.decrementRef(realm, oldRoot);

    // Update depot with rollback message
    const { depot: updatedDepot } = await this.depotDb.updateRoot(
      realm,
      depotId,
      newRoot,
      `Rollback to version ${version}`
    );

    return jsonResponse(200, {
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private parseJson(req: HttpRequest): unknown {
    if (!req.body) return {};

    // Body is already decoded by handler, just convert to string
    const bodyStr = typeof req.body === "string" ? req.body : req.body.toString("utf-8");

    try {
      return JSON.parse(bodyStr);
    } catch {
      return {};
    }
  }

  private getBinaryBody(req: HttpRequest): Buffer {
    if (!req.body) return Buffer.alloc(0);

    // Body is already decoded by handler
    if (Buffer.isBuffer(req.body)) {
      return req.body;
    }

    if (typeof req.body === "string") {
      return Buffer.from(req.body, "utf-8");
    }

    return Buffer.alloc(0);
  }
}
