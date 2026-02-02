/**
 * CAS Stack - Local Development Server (Bun)
 *
 * Uses in-memory storage for local development without AWS dependencies.
 * Supports Cognito JWT authentication for cas-webui integration.
 */

import { createHash as cryptoCreateHash } from "node:crypto";
import {
  AWP_AUTH_HEADERS,
  generateVerificationCode,
  validateTimestamp,
  verifySignature,
} from "@agent-web-portal/auth";
import { decodeNode } from "@agent-web-portal/cas-core";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { getCognitoUserMap } from "./src/auth/cognito-users.ts";
import { EMPTY_COLLECTION_DATA, EMPTY_COLLECTION_KEY } from "./src/controllers/types.ts";
import {
  AwpPendingAuthStore,
  AwpPubkeyStore,
  CommitsDb,
  DagDb,
  DepotDb,
  MAIN_DEPOT_NAME,
  OwnershipDb,
  TokensDb,
  UserRolesDb,
} from "./src/db/index.ts";
import {
  FileCasStorage,
  MemoryAgentTokensDb,
  MemoryAwpPendingAuthStore,
  MemoryAwpPubkeyStore,
  MemoryCasStorage,
  MemoryCommitsDb,
  MemoryDagDb,
  MemoryDepotDb,
  MemoryOwnershipDb,
  MemoryTokensDb,
} from "./src/db/memory/index.ts";
import type { CasStorageInterface } from "./src/db/memory/types.ts";
import { createAgentTokensDbAdapter } from "./src/db/tokens.ts";
import { loadConfig, loadServerConfig } from "./src/types.ts";

function tokenIdFromPk(pk: string): string {
  return pk.replace("token#", "");
}

// ============================================================================
// Cognito JWT Verifier (for cas-webui integration)
// ============================================================================

// Cognito configuration from env (COGNITO_* only)
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
const COGNITO_REGION =
  process.env.COGNITO_REGION ?? (COGNITO_USER_POOL_ID.split("_")[0] || "us-east-1");
const COGNITO_ISSUER = COGNITO_USER_POOL_ID
  ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`
  : "";

// JWKS for Cognito JWT verification
const cognitoJwks = COGNITO_USER_POOL_ID
  ? createRemoteJWKSet(new URL(`${COGNITO_ISSUER}/.well-known/jwks.json`), {
      timeoutDuration: 10000, // 10 seconds timeout
    })
  : null;

interface CognitoTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  token_use: "access" | "id";
  exp: number;
}

async function verifyCognitoToken(token: string): Promise<CognitoTokenPayload | null> {
  if (!cognitoJwks || !COGNITO_ISSUER) {
    return null;
  }

  try {
    const { payload } = await jwtVerify(token, cognitoJwks, {
      issuer: COGNITO_ISSUER,
    });
    return payload as unknown as CognitoTokenPayload;
  } catch (error) {
    console.error("[Cognito] JWT verification failed:", error);
    return null;
  }
}

// ============================================================================
// Local Router - use DynamoDB when DYNAMODB_ENDPOINT is set (e.g. local Docker)
// ============================================================================

const useDynamo = !!process.env.DYNAMODB_ENDPOINT;

const tokensDb = useDynamo ? new TokensDb(loadConfig()) : new MemoryTokensDb(loadServerConfig());
const ownershipDb = useDynamo ? new OwnershipDb(loadConfig()) : new MemoryOwnershipDb();
const _dagDb = useDynamo ? new DagDb(loadConfig()) : new MemoryDagDb();
const commitsDb = useDynamo ? new CommitsDb(loadConfig()) : new MemoryCommitsDb();
const depotDb = useDynamo ? new DepotDb(loadConfig()) : new MemoryDepotDb();
// Use FileCasStorage when CAS_STORAGE_DIR is set, otherwise MemoryCasStorage
const casStorageDir = process.env.CAS_STORAGE_DIR;
const casStorage: CasStorageInterface = casStorageDir
  ? new FileCasStorage(casStorageDir)
  : new MemoryCasStorage();
const pendingAuthStore = useDynamo
  ? new AwpPendingAuthStore(loadConfig())
  : new MemoryAwpPendingAuthStore();
const pubkeyStore = useDynamo ? new AwpPubkeyStore(loadConfig()) : new MemoryAwpPubkeyStore();
const agentTokensDb = useDynamo
  ? createAgentTokensDbAdapter(tokensDb as TokensDb, loadServerConfig())
  : new MemoryAgentTokensDb();
const userRolesDb = useDynamo ? new UserRolesDb(loadConfig()) : null;

/**
 * Ensure empty collection exists in storage and ownership
 */
async function ensureEmptyCollection(realm: string, tokenId: string): Promise<void> {
  console.log(`[ensureEmptyCollection] realm=${realm}, tokenId=${tokenId}`);
  // Check if already exists
  const exists = await casStorage.get(EMPTY_COLLECTION_KEY);
  console.log(`[ensureEmptyCollection] exists=${!!exists}`);
  if (!exists) {
    console.log(`[ensureEmptyCollection] storing empty collection`);
    await casStorage.putWithKey(
      EMPTY_COLLECTION_KEY,
      EMPTY_COLLECTION_DATA,
      "application/vnd.cas.collection"
    );
  }
  // Ensure ownership
  const hasOwnership = await ownershipDb.hasOwnership(realm, EMPTY_COLLECTION_KEY);
  console.log(`[ensureEmptyCollection] hasOwnership=${hasOwnership}`);
  if (!hasOwnership) {
    console.log(`[ensureEmptyCollection] adding ownership`);
    await ownershipDb.addOwnership(
      realm,
      EMPTY_COLLECTION_KEY,
      tokenId,
      "application/vnd.cas.collection",
      EMPTY_COLLECTION_DATA.length
    );
  }
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function binaryResponse(content: Buffer, contentType: string): Response {
  return new Response(new Uint8Array(content), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": content.length.toString(),
      ...CORS_HEADERS,
    },
  });
}

function errorResponse(status: number, error: string, details?: unknown): Response {
  return jsonResponse(status, { error, details });
}

interface AuthContext {
  userId: string;
  scope: string;
  canRead: boolean;
  canWrite: boolean;
  canIssueTicket: boolean;
  tokenId: string;
  allowedKey?: string;
}

async function authenticate(req: Request): Promise<AuthContext | null> {
  // First check for AWP signed request
  const awpPubkey = req.headers.get(AWP_AUTH_HEADERS.pubkey);
  if (awpPubkey) {
    return authenticateAwp(req);
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return null;

  const [_scheme, tokenValue] = authHeader.split(" ");
  if (!tokenValue) return null;

  // Check if it's a JWT (Cognito token) - JWTs have 3 parts separated by dots
  if (tokenValue.split(".").length === 3) {
    const cognitoPayload = await verifyCognitoToken(tokenValue);
    if (cognitoPayload) {
      // Create or get user token for this Cognito user
      const userId = cognitoPayload.sub;

      // Check if we already have a user token for this session
      // For simplicity, create a new one each time (or reuse existing)
      const userToken = await tokensDb.createUserToken(userId, "cognito-session", 3600);
      const tokenId = tokenIdFromPk(userToken.pk);

      console.log(`[Cognito] Authenticated user: ${cognitoPayload.email ?? userId}`);

      return {
        userId,
        scope: `usr_${userId}`,
        canRead: true,
        canWrite: true,
        canIssueTicket: true,
        tokenId,
      };
    }
    // If JWT verification failed, fall through to try as internal token
  }

  // Try as internal token (user token or ticket)
  const token = await tokensDb.getToken(tokenValue);
  if (!token) return null;

  const id = tokenIdFromPk(token.pk);

  if (token.type === "user") {
    return {
      userId: token.userId,
      scope: `usr_${token.userId}`,
      canRead: true,
      canWrite: true,
      canIssueTicket: true,
      tokenId: id,
    };
  }

  if (token.type === "ticket") {
    return {
      userId: "",
      scope: token.realm,
      canRead: true,
      canWrite: !!token.commit && !token.commit.root,
      canIssueTicket: false,
      tokenId: id,
      allowedKey: token.scope?.[0],
    };
  }

  return null;
}

async function authenticateByTicketId(ticketId: string): Promise<AuthContext | null> {
  const token = await tokensDb.getToken(ticketId);
  if (!token || token.type !== "ticket") return null;

  const id = tokenIdFromPk(token.pk);
  return {
    userId: "",
    scope: token.realm,
    canRead: true,
    canWrite: !!token.commit && !token.commit.root,
    canIssueTicket: false,
    tokenId: id,
    allowedKey: token.scope?.[0],
  };
}

async function authenticateAwp(req: Request): Promise<AuthContext | null> {
  const pubkey = req.headers.get(AWP_AUTH_HEADERS.pubkey);
  const timestamp = req.headers.get(AWP_AUTH_HEADERS.timestamp);
  const signature = req.headers.get(AWP_AUTH_HEADERS.signature);

  if (!pubkey || !timestamp || !signature) {
    return null;
  }

  // Look up the pubkey
  const authorizedPubkey = await pubkeyStore.lookup(pubkey);
  if (!authorizedPubkey) {
    return null;
  }

  // Verify timestamp
  if (!validateTimestamp(timestamp, 300)) {
    // 5 minute max clock skew
    console.log(`[AWP] Timestamp validation failed for pubkey: ${pubkey.slice(0, 20)}...`);
    return null;
  }

  // Verify the signature
  const url = new URL(req.url);
  const body = req.method === "GET" || req.method === "HEAD" ? "" : await req.clone().text();

  // Build signature payload: timestamp.METHOD.path.bodyHash
  const bodyHash = cryptoCreateHash("sha256").update(body).digest("hex");
  const signaturePayload = `${timestamp}.${req.method.toUpperCase()}.${url.pathname + url.search}.${bodyHash}`;

  const isValid = await verifySignature(pubkey, signaturePayload, signature);

  if (!isValid) {
    console.log(`[AWP] Signature verification failed for pubkey: ${pubkey.slice(0, 20)}...`);
    return null;
  }

  console.log(`[AWP] Authenticated client: ${authorizedPubkey.clientName}`);

  return {
    userId: authorizedPubkey.userId,
    scope: `usr_${authorizedPubkey.userId}`,
    canRead: true,
    canWrite: true,
    canIssueTicket: true,
    tokenId: `awp_${pubkey.slice(0, 16)}`,
  };
}

// ============================================================================
// Request Handlers
// ============================================================================

const COGNITO_HOSTED_UI_URL = process.env.COGNITO_HOSTED_UI_URL ?? "";
const COGNITO_CLIENT_ID =
  process.env.CASFA_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? "";

async function handleOAuth(req: Request, path: string): Promise<Response> {
  // GET /oauth/config - Public Cognito config for frontend (no auth)
  if (req.method === "GET" && path === "/config") {
    return jsonResponse(200, {
      cognitoUserPoolId: COGNITO_USER_POOL_ID,
      cognitoClientId: COGNITO_CLIENT_ID,
      cognitoHostedUiUrl: COGNITO_HOSTED_UI_URL,
    });
  }

  // POST /oauth/token - Exchange authorization code for tokens
  if (req.method === "POST" && path === "/token") {
    if (!COGNITO_HOSTED_UI_URL || !COGNITO_CLIENT_ID) {
      return errorResponse(
        503,
        "OAuth / Google sign-in not configured (missing Hosted UI URL or Client ID)"
      );
    }
    const body = (await req.json()) as { code?: string; redirect_uri?: string };
    if (!body.code || !body.redirect_uri) {
      return errorResponse(400, "Missing code or redirect_uri");
    }
    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: COGNITO_CLIENT_ID,
      code: body.code,
      redirect_uri: body.redirect_uri,
    });
    const tokenRes = await fetch(`${COGNITO_HOSTED_UI_URL}/oauth2/token`, {
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

  // GET /oauth/me - Current user info and role (requires auth)
  if (req.method === "GET" && path === "/me") {
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }
    // Ensure user record exists so admins can see and authorize them
    if (userRolesDb && auth.userId) {
      await userRolesDb.ensureUser(auth.userId);
    }
    const role = userRolesDb ? await userRolesDb.getRole(auth.userId) : "authorized";
    return jsonResponse(200, {
      userId: auth.userId,
      realm: auth.scope,
      role,
    });
  }

  return errorResponse(404, "OAuth endpoint not found");
}

async function handleAuth(req: Request, path: string): Promise<Response> {
  // ========================================================================
  // AWP Client Routes (no auth required for init/status)
  // ========================================================================

  // POST /auth/clients/init - Start AWP auth flow
  if (req.method === "POST" && path === "/clients/init") {
    const body = (await req.json()) as { pubkey?: string; client_name?: string };
    if (!body.pubkey || !body.client_name) {
      return errorResponse(400, "Missing pubkey or client_name");
    }

    const verificationCode = generateVerificationCode();
    const now = Date.now();
    const expiresIn = 600; // 10 minutes

    await pendingAuthStore.create({
      pubkey: body.pubkey,
      clientName: body.client_name,
      verificationCode,
      createdAt: now,
      expiresAt: now + expiresIn * 1000,
    });

    // Build auth URL
    const url = new URL(req.url);
    const authUrl = `${url.origin}/auth/awp?pubkey=${encodeURIComponent(body.pubkey)}`;

    console.log(`[AWP] Auth initiated for client: ${body.client_name}`);
    console.log(`[AWP] Verification code: ${verificationCode}`);

    return jsonResponse(200, {
      auth_url: authUrl,
      verification_code: verificationCode,
      expires_in: expiresIn,
      poll_interval: 5,
    });
  }

  // GET /auth/clients/status - Poll for auth completion
  if (req.method === "GET" && path === "/clients/status") {
    const url = new URL(req.url);
    const pubkey = url.searchParams.get("pubkey");
    if (!pubkey) {
      return errorResponse(400, "Missing pubkey parameter");
    }

    const authorized = await pubkeyStore.lookup(pubkey);
    if (authorized) {
      return jsonResponse(200, {
        authorized: true,
        expires_at: authorized.expiresAt,
      });
    }

    // Check if pending auth exists
    const pending = await pendingAuthStore.get(pubkey);
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
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "User authentication required");
    }

    const body = (await req.json()) as { pubkey?: string; verification_code?: string };
    if (!body.pubkey || !body.verification_code) {
      return errorResponse(400, "Missing pubkey or verification_code");
    }

    // Validate verification code
    const isValid = await pendingAuthStore.validateCode(body.pubkey, body.verification_code);
    if (!isValid) {
      return errorResponse(400, "Invalid or expired verification code");
    }

    // Get pending auth to retrieve client name
    const pending = await pendingAuthStore.get(body.pubkey);
    if (!pending) {
      return errorResponse(400, "Pending authorization not found");
    }

    // Store authorized pubkey
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    await pubkeyStore.store({
      pubkey: body.pubkey,
      userId: auth.userId,
      clientName: pending.clientName,
      createdAt: now,
      expiresAt,
    });

    // Clean up pending auth
    await pendingAuthStore.delete(body.pubkey);

    console.log(`[AWP] Client authorized: ${pending.clientName} for user: ${auth.userId}`);

    return jsonResponse(200, {
      success: true,
      expires_at: expiresAt,
    });
  }

  // Routes requiring auth
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Unauthorized - use Cognito via cas-webui to login");
  }

  // Ensure user record exists so admins can see and authorize them
  if (userRolesDb && auth.userId) {
    await userRolesDb.ensureUser(auth.userId);
  }

  // GET /auth/clients - List authorized AWP clients
  if (req.method === "GET" && path === "/clients") {
    const clients = await pubkeyStore.listByUser(auth.userId);
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
    const client = await pubkeyStore.lookup(pubkey);
    if (!client || client.userId !== auth.userId) {
      return errorResponse(404, "Client not found or access denied");
    }

    await pubkeyStore.revoke(pubkey);
    console.log(`[AWP] Client revoked: ${client.clientName}`);
    return jsonResponse(200, { success: true });
  }

  // POST /auth/ticket
  if (req.method === "POST" && path === "/ticket") {
    if (!auth.canIssueTicket) {
      return errorResponse(403, "Not authorized to issue tickets");
    }
    const body = (await req.json()) as {
      scope?: string | string[];
      commit?: boolean | { quota?: number; accept?: string[] };
      expiresIn?: number;
    };
    // Normalize scope to string[] | undefined
    const normalizedScope =
      body.scope === undefined ? undefined : Array.isArray(body.scope) ? body.scope : [body.scope];
    // Normalize commit: true -> {}, false/undefined -> undefined
    const normalizedCommit =
      body.commit === true
        ? {}
        : body.commit === false || body.commit === undefined
          ? undefined
          : body.commit;
    const ticket = await tokensDb.createTicket(
      auth.scope,
      auth.tokenId,
      normalizedScope,
      normalizedCommit,
      body.expiresIn
    );
    const ticketId = tokenIdFromPk(ticket.pk);
    const serverConfig = loadServerConfig();
    return jsonResponse(201, {
      id: ticketId,
      endpoint: `${serverConfig.baseUrl}/api/ticket/${ticketId}`,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
      realm: ticket.realm,
      scope: ticket.scope,
      commit: ticket.commit ?? false,
      config: ticket.config,
    });
  }

  // DELETE /auth/ticket/:id
  const ticketMatch = path.match(/^\/ticket\/([^/]+)$/);
  if (req.method === "DELETE" && ticketMatch) {
    const ticketId = ticketMatch[1]!;
    const isOwner = await tokensDb.verifyTokenOwnership(ticketId, auth.userId);
    if (!isOwner) {
      return errorResponse(404, "Ticket not found");
    }
    await tokensDb.deleteToken(ticketId);
    return jsonResponse(200, { success: true });
  }

  // ========================================================================
  // Agent Token Management Routes (for WebUI)
  // ========================================================================

  // GET /auth/tokens - List agent tokens
  if (req.method === "GET" && path === "/tokens") {
    const tokens = await agentTokensDb.listByUser(auth.userId);
    return jsonResponse(200, {
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        expiresAt: new Date(t.expiresAt).toISOString(),
        createdAt: new Date(t.createdAt).toISOString(),
      })),
    });
  }

  // POST /auth/tokens - Create agent token
  if (req.method === "POST" && path === "/tokens") {
    const body = (await req.json()) as {
      name?: string;
      description?: string;
      expiresIn?: number;
    };
    if (!body.name) {
      return errorResponse(400, "Missing name");
    }
    const token = await agentTokensDb.create(auth.userId, body.name, {
      description: body.description,
      expiresIn: body.expiresIn,
    });
    return jsonResponse(201, {
      id: token.id,
      name: token.name,
      description: token.description,
      expiresAt: new Date(token.expiresAt).toISOString(),
      createdAt: new Date(token.createdAt).toISOString(),
    });
  }

  // DELETE /auth/tokens/:id - Revoke agent token
  const agentTokenMatch = path.match(/^\/tokens\/([^/]+)$/);
  if (req.method === "DELETE" && agentTokenMatch) {
    const tokenId = agentTokenMatch[1]!;
    const success = await agentTokensDb.revoke(auth.userId, tokenId);
    if (!success) {
      return errorResponse(404, "Agent token not found");
    }
    return jsonResponse(200, { success: true });
  }

  return errorResponse(404, "Auth endpoint not found");
}

async function handleAdmin(req: Request, path: string): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Unauthorized");
  }

  // Helper: current user is admin (when userRolesDb: check role; when in-memory: allow for dev)
  const isAdmin = userRolesDb ? (await userRolesDb.getRole(auth.userId)) === "admin" : true;
  if (!isAdmin) {
    return errorResponse(403, "Admin access required");
  }

  // GET /admin/users - List users with roles, enriched with email/name from Cognito
  if (req.method === "GET" && path === "/users") {
    if (!userRolesDb) return jsonResponse(200, { users: [] });
    const list = await userRolesDb.listRoles();
    const cognitoMap = await getCognitoUserMap(COGNITO_USER_POOL_ID, COGNITO_REGION);
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
    if (!userRolesDb)
      return errorResponse(503, "User role management requires DynamoDB (set DYNAMODB_ENDPOINT)");
    const targetUserId = decodeURIComponent(authorizePostMatch[1]!);
    const body = (await req.json()) as { role?: string };
    const role = body.role === "admin" ? "admin" : "authorized";
    await userRolesDb.setRole(targetUserId, role);
    return jsonResponse(200, { userId: targetUserId, role });
  }

  // DELETE /admin/users/:userId/authorize - Revoke user
  const authorizeDeleteMatch = path.match(/^\/users\/([^/]+)\/authorize$/);
  if (req.method === "DELETE" && authorizeDeleteMatch) {
    if (!userRolesDb)
      return errorResponse(503, "User role management requires DynamoDB (set DYNAMODB_ENDPOINT)");
    const targetUserId = decodeURIComponent(authorizeDeleteMatch[1]!);
    await userRolesDb.revoke(targetUserId);
    return jsonResponse(200, { userId: targetUserId, revoked: true });
  }

  return errorResponse(404, "Admin endpoint not found");
}

/**
 * Handle /api/realm/{realmId}/... routes
 * These are the standard CAS API endpoints matching router.ts
 */
async function handleRealm(req: Request, realmId: string, subPath: string): Promise<Response> {
  const serverConfig = loadServerConfig();

  // Authenticate - requires Authorization header
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Authorization required");
  }

  // Check realm access - user can only access their own realm
  if (realmId !== auth.scope) {
    return errorResponse(403, "Access denied to this realm");
  }

  const realm = realmId;

  // GET /realm/{realmId} - Return endpoint info
  if (req.method === "GET" && subPath === "") {
    return jsonResponse(200, {
      realm,
      commit: auth.canWrite ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    });
  }

  // GET /commits - List commits for realm
  if (req.method === "GET" && subPath === "/commits") {
    const url = new URL(req.url);
    const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "100", 10), 1000);
    const result = await commitsDb.listByScan(realm, { limit });
    return jsonResponse(200, {
      commits: result.commits.map((c) => ({
        root: c.root,
        title: c.title,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
      nextKey: result.nextKey,
    });
  }

  // GET /commits/:root - Get commit details
  const getCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "GET" && getCommitMatch) {
    const root = decodeURIComponent(getCommitMatch[1]!);
    const commit = await commitsDb.get(realm, root);
    if (!commit) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, {
      root: commit.root,
      title: commit.title,
      createdAt: new Date(commit.createdAt).toISOString(),
    });
  }

  // PATCH /commits/:root - Update commit metadata
  const patchCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "PATCH" && patchCommitMatch) {
    const root = decodeURIComponent(patchCommitMatch[1]!);
    const body = (await req.json()) as { title?: string };
    const updated = await commitsDb.updateTitle(realm, root, body.title);
    if (!updated) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, { success: true });
  }

  // DELETE /commits/:root - Delete commit
  const deleteCommitMatch = subPath.match(/^\/commits\/(.+)$/);
  if (req.method === "DELETE" && deleteCommitMatch) {
    const root = decodeURIComponent(deleteCommitMatch[1]!);
    const deleted = await commitsDb.delete(realm, root);
    if (!deleted) {
      return errorResponse(404, "Commit not found");
    }
    return jsonResponse(200, { success: true });
  }

  // POST /commit - Create a new commit
  if (req.method === "POST" && subPath === "/commit") {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const body = (await req.json()) as {
      title?: string;
      tree?: Record<string, unknown>;
      root?: string;
    };

    // Build collection from tree structure
    if (body.tree && Object.keys(body.tree).length > 0) {
      // Recursively build CAS collection structure
      const buildCollection = async (
        tree: Record<string, unknown>
      ): Promise<{ key: string; size: number }> => {
        const children: Record<string, string> = {};
        let totalSize = 0;

        for (const [name, value] of Object.entries(tree)) {
          if (typeof value === "object" && value !== null) {
            const v = value as Record<string, unknown>;
            if ("chunks" in v && Array.isArray(v.chunks)) {
              // It's a file reference - use the first chunk as the file key
              const chunkKey = v.chunks[0] as string;
              children[name] = chunkKey;
              totalSize += (v.size as number) || 0;
            } else {
              // It's a nested folder
              const subCollection = await buildCollection(v);
              children[name] = subCollection.key;
              totalSize += subCollection.size;
            }
          }
        }

        // Create collection
        const collectionData = JSON.stringify({ children });
        const content = Buffer.from(collectionData, "utf-8");
        const hash = cryptoCreateHash("sha256").update(content).digest("hex");
        const collectionKey = `sha256:${hash}`;

        await casStorage.putWithKey(collectionKey, content, "application/vnd.cas.collection");
        await ownershipDb.addOwnership(
          realm,
          collectionKey,
          auth.tokenId,
          "application/vnd.cas.collection",
          content.length
        );

        return { key: collectionKey, size: totalSize };
      };

      const rootCollection = await buildCollection(body.tree);

      // Create commit record
      await commitsDb.create(realm, rootCollection.key, auth.tokenId, body.title);

      return jsonResponse(200, {
        success: true,
        root: rootCollection.key,
      });
    }

    // If root is provided directly
    if (body.root) {
      await commitsDb.create(realm, body.root, auth.tokenId, body.title);
      return jsonResponse(200, {
        success: true,
        root: body.root,
      });
    }

    return errorResponse(400, "Either tree or root is required");
  }

  // PUT /chunks/:key - Upload chunk
  const putChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
  if (req.method === "PUT" && putChunkMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putChunkMatch[1]!);
    const content = Buffer.from(await req.arrayBuffer());
    if (content.length === 0) {
      return errorResponse(400, "Empty body");
    }
    const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

    const result = await casStorage.putWithKey(key, content, contentType);
    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    await ownershipDb.addOwnership(realm, result.key, auth.tokenId, contentType, result.size);

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
    });
  }

  // GET /chunks/:key - Get chunk
  const getChunkMatch = subPath.match(/^\/chunks\/(.+)$/);
  if (req.method === "GET" && getChunkMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getChunkMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(realm, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const blob = await casStorage.get(key);
    if (!blob) {
      return errorResponse(404, "Content not found");
    }

    return binaryResponse(blob.content, blob.contentType);
  }

  // GET /tree/:key - Get tree structure
  const getTreeMatch = subPath.match(/^\/tree\/(.+)$/);
  if (req.method === "GET" && getTreeMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const rootKey = decodeURIComponent(getTreeMatch[1]!);

    // Special case: empty collection - ensure it exists
    if (rootKey === EMPTY_COLLECTION_KEY) {
      console.log(`[tree] detected empty collection key, calling ensureEmptyCollection`);
      await ensureEmptyCollection(realm, auth.tokenId);
    }

    const hasAccess = await ownershipDb.hasOwnership(realm, rootKey);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    // Build tree recursively
    const buildTree = async (key: string): Promise<Record<string, unknown> | null> => {
      // Special case: empty collection
      if (key === EMPTY_COLLECTION_KEY) {
        return {
          kind: "collection",
          key,
          size: 0,
          children: {},
        };
      }

      const blob = await casStorage.get(key);
      if (!blob) {
        console.log(`[tree] blob not found for key: ${key}`);
        return null;
      }

      const { content, metadata } = blob;
      console.log(`[tree] key=${key}, size=${content.length}`);

      try {
        // Parse binary CAS format
        const node = decodeNode(new Uint8Array(content));
        console.log(
          `[tree] decoded node kind=${node.kind}, childNames=${node.childNames?.length ?? 0}`
        );

        if (node.kind === "collection" && node.childNames && node.children) {
          const { childNames, children } = node;
          const result: Record<string, unknown> = {
            kind: "collection",
            key,
            size: node.size,
            children: {} as Record<string, unknown>,
          };

          // Build child map from children and childNames arrays
          for (let i = 0; i < childNames.length; i++) {
            const name = childNames[i];
            const childHash = children[i];
            if (!name || !childHash) continue;
            // Convert hash bytes to sha256:hex format
            const childKey = `sha256:${Buffer.from(childHash).toString("hex")}`;
            const childTree = await buildTree(childKey);
            if (childTree) {
              (result.children as Record<string, unknown>)[name] = childTree;
            }
          }
          return result;
        } else {
          // It's a file/chunk
          return {
            kind: "file",
            key,
            size: node.size,
            contentType: node.contentType ?? metadata.casContentType,
          };
        }
      } catch (e) {
        console.log(`[tree] decodeNode error for ${key}:`, e);
        return null;
      }
    };

    const tree = await buildTree(rootKey);
    if (!tree) {
      return errorResponse(404, "Failed to build tree");
    }

    return jsonResponse(200, tree);
  }

  // ========================================================================
  // Depot Routes
  // ========================================================================

  // GET /depots - List all depots
  if (req.method === "GET" && subPath === "/depots") {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    // Ensure empty collection and main depot exist
    await ensureEmptyCollection(realm, auth.tokenId);
    await depotDb.ensureMainDepot(realm, EMPTY_COLLECTION_KEY);
    const result = await depotDb.list(realm);
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

  // POST /depots - Create a new depot
  if (req.method === "POST" && subPath === "/depots") {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const body = (await req.json()) as { name: string; description?: string };
    if (!body.name) {
      return errorResponse(400, "Name is required");
    }

    // Check if depot with this name already exists
    const existing = await depotDb.getByName(realm, body.name);
    if (existing) {
      return errorResponse(409, `Depot with name '${body.name}' already exists`);
    }

    // Ensure empty collection exists
    await ensureEmptyCollection(realm, auth.tokenId);

    const depot = await depotDb.create(realm, {
      name: body.name,
      root: EMPTY_COLLECTION_KEY,
      description: body.description,
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

  // GET /depots/:depotId - Get depot by ID
  const getDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "GET" && getDepotMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    const depotId = decodeURIComponent(getDepotMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
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

  // PUT /depots/:depotId - Update depot root
  const putDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "PUT" && putDepotMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(putDepotMatch[1]!);
    const body = (await req.json()) as { root: string; message?: string };
    if (!body.root) {
      return errorResponse(400, "Root is required");
    }

    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const { depot: updatedDepot } = await depotDb.updateRoot(
      realm,
      depotId,
      body.root,
      body.message
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

  // DELETE /depots/:depotId - Delete depot
  const deleteDepotMatch = subPath.match(/^\/depots\/([^/]+)$/);
  if (req.method === "DELETE" && deleteDepotMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(deleteDepotMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }
    if (depot.name === MAIN_DEPOT_NAME) {
      return errorResponse(403, "Cannot delete the main depot");
    }
    await depotDb.delete(realm, depotId);
    return jsonResponse(200, { deleted: true });
  }

  // GET /depots/:depotId/history - List depot history
  const getHistoryMatch = subPath.match(/^\/depots\/([^/]+)\/history$/);
  if (req.method === "GET" && getHistoryMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access required");
    }
    const depotId = decodeURIComponent(getHistoryMatch[1]!);
    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }
    const result = await depotDb.listHistory(realm, depotId);
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

  // POST /depots/:depotId/rollback - Rollback to a previous version
  const rollbackMatch = subPath.match(/^\/depots\/([^/]+)\/rollback$/);
  if (req.method === "POST" && rollbackMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access required");
    }
    const depotId = decodeURIComponent(rollbackMatch[1]!);
    const body = (await req.json()) as { version: number };
    if (!body.version) {
      return errorResponse(400, "Version is required");
    }

    const depot = await depotDb.get(realm, depotId);
    if (!depot) {
      return errorResponse(404, "Depot not found");
    }

    const historyRecord = await depotDb.getHistory(realm, depotId, body.version);
    if (!historyRecord) {
      return errorResponse(404, `Version ${body.version} not found`);
    }

    const { depot: updatedDepot } = await depotDb.updateRoot(
      realm,
      depotId,
      historyRecord.root,
      `Rollback to version ${body.version}`
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

  return errorResponse(404, "Realm endpoint not found");
}

async function handleCas(req: Request, requestedRealm: string, subPath: string): Promise<Response> {
  const serverConfig = loadServerConfig();
  console.log(`[handleCas] method=${req.method}, realm=${requestedRealm}, subPath="${subPath}"`);

  // GET /cas/{realm} - Return endpoint info
  if (req.method === "GET" && subPath === "") {
    // Ticket realm - no auth required
    if (requestedRealm.startsWith("tkt_")) {
      const ticketId = requestedRealm;
      const token = await tokensDb.getToken(ticketId);
      if (!token || token.type !== "ticket") {
        return errorResponse(404, "Ticket not found");
      }
      if (token.expiresAt < Date.now()) {
        return errorResponse(410, "Ticket expired");
      }

      // Build commit permission
      let commit: { quota?: number; accept?: string[]; root?: string } | undefined;
      if (token.commit) {
        commit = {
          quota: token.commit.quota,
          accept: token.commit.accept,
          root: token.commit.root,
        };
      }

      return jsonResponse(200, {
        realm: token.realm,
        scope: token.scope,
        commit,
        expiresAt: new Date(token.expiresAt).toISOString(),
        nodeLimit: serverConfig.nodeLimit,
        maxNameBytes: serverConfig.maxNameBytes,
      });
    }

    // User realm - requires auth
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "Unauthorized");
    }

    let effectiveScope: string;
    if (requestedRealm === "@me" || requestedRealm === "~") {
      effectiveScope = auth.scope;
    } else {
      if (requestedRealm !== auth.scope) {
        return errorResponse(403, "Access denied to this scope");
      }
      effectiveScope = requestedRealm;
    }

    return jsonResponse(200, {
      realm: effectiveScope,
      // No scope restriction for user realm (full access)
      commit: auth.canWrite ? {} : undefined,
      nodeLimit: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
    });
  }

  // Authenticate - ticket realm uses ticket ID directly, otherwise standard auth
  let auth: AuthContext | null;
  if (requestedRealm.startsWith("tkt_")) {
    auth = await authenticateByTicketId(requestedRealm);
  } else {
    auth = await authenticate(req);
  }
  if (!auth) {
    return errorResponse(401, "Unauthorized");
  }

  // Resolve scope:
  // - @me or ~ resolves to user's scope
  // - tkt_ realm uses the ticket's actual realm
  // - explicit scope must match auth.scope
  let effectiveScope: string;
  if (requestedRealm === "@me" || requestedRealm === "~") {
    effectiveScope = auth.scope;
  } else if (requestedRealm.startsWith("tkt_")) {
    effectiveScope = auth.scope; // ticket's realm
  } else {
    // Explicit scope - must match
    if (requestedRealm !== auth.scope) {
      return errorResponse(403, "Access denied to this scope");
    }
    effectiveScope = requestedRealm;
  }

  // PUT /chunk/:key - Upload chunk data
  const putChunkMatch = subPath.match(/^\/chunk\/(.+)$/);
  if (req.method === "PUT" && putChunkMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putChunkMatch[1]!);
    const content = Buffer.from(await req.arrayBuffer());
    if (content.length === 0) {
      return errorResponse(400, "Empty body");
    }
    const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

    const result = await casStorage.putWithKey(key, content, contentType);
    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    await ownershipDb.addOwnership(
      effectiveScope,
      result.key,
      auth.tokenId,
      contentType,
      result.size
    );

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
    });
  }

  // PUT /raw/:key - Upload raw node data (alias for /chunk/:key)
  const putRawMatch = subPath.match(/^\/raw\/(.+)$/);
  if (req.method === "PUT" && putRawMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putRawMatch[1]!);
    const content = Buffer.from(await req.arrayBuffer());
    if (content.length === 0) {
      return errorResponse(400, "Empty body");
    }
    const contentType = req.headers.get("Content-Type") ?? "application/octet-stream";

    const result = await casStorage.putWithKey(key, content, contentType);
    if ("error" in result) {
      return errorResponse(400, "Hash mismatch", {
        expected: result.expected,
        actual: result.actual,
      });
    }

    await ownershipDb.addOwnership(
      effectiveScope,
      result.key,
      auth.tokenId,
      contentType,
      result.size
    );

    return jsonResponse(200, {
      key: result.key,
      size: result.size,
    });
  }

  // GET /tree/:key - Get complete DAG structure
  const getTreeMatch = subPath.match(/^\/tree\/(.+)$/);
  if (req.method === "GET" && getTreeMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const rootKey = decodeURIComponent(getTreeMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, rootKey);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const MAX_NODES = 1000;
    const nodes: Record<string, any> = {};
    const queue: string[] = [rootKey];
    let next: string | undefined;

    while (queue.length > 0) {
      if (Object.keys(nodes).length >= MAX_NODES) {
        next = queue[0];
        break;
      }

      const key = queue.shift()!;
      if (nodes[key]) continue;

      const blob = await casStorage.get(key);
      if (!blob) continue;

      const { content, contentType, metadata } = blob;

      if (contentType === "application/vnd.cas.collection") {
        try {
          const data = JSON.parse(content.toString("utf-8"));
          const children = data.children as Record<string, string>;
          nodes[key] = {
            kind: "collection",
            size: metadata.casSize ?? content.length,
            children,
          };
          for (const childKey of Object.values(children)) {
            if (!nodes[childKey]) {
              queue.push(childKey);
            }
          }
        } catch {
          // Invalid JSON
        }
      } else if (contentType === "application/vnd.cas.file") {
        const chunkCount = content.length / 64;
        nodes[key] = {
          kind: "file",
          size: metadata.casSize ?? 0,
          contentType: metadata.casContentType,
          chunks: chunkCount,
        };
      } else if (contentType === "application/vnd.cas.inline-file") {
        nodes[key] = {
          kind: "inline-file",
          size: metadata.casSize ?? content.length,
          contentType: metadata.casContentType,
        };
      }
    }

    const response: any = { nodes };
    if (next) {
      response.next = next;
    }

    return jsonResponse(200, response);
  }

  // GET /raw/:key - Get raw node data with metadata headers
  const getRawMatch = subPath.match(/^\/raw\/(.+)$/);
  if (req.method === "GET" && getRawMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getRawMatch[1]!);

    if (auth.allowedKey && auth.allowedKey !== key) {
      return errorResponse(403, "Read access denied for this key");
    }

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const blob = await casStorage.get(key);
    if (!blob) {
      return errorResponse(404, "Content not found");
    }

    const { content, contentType, metadata } = blob;
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(content.length),
    };

    if (metadata.casContentType) {
      headers["X-CAS-Content-Type"] = metadata.casContentType;
    }
    if (metadata.casSize !== undefined) {
      headers["X-CAS-Size"] = String(metadata.casSize);
    }

    return new Response(new Uint8Array(content), { status: 200, headers });
  }

  return errorResponse(404, "CAS endpoint not found");
}

// ============================================================================
// Server
// ============================================================================

const PORT = parseInt(process.env.CAS_API_PORT ?? process.env.PORT ?? "3550", 10);

if (!COGNITO_USER_POOL_ID) {
  console.error("ERROR: COGNITO_USER_POOL_ID environment variable is required");
  console.error("Set COGNITO_USER_POOL_ID in .env, or run: awp config pull");
  process.exit(1);
}

const authInfo = `║  Auth: Cognito + Google Sign-In                              ║
║    User Pool: ${COGNITO_USER_POOL_ID.padEnd(43)}║
║    Login via cas-webui with Google                           ║`;

const storageInfo = useDynamo
  ? "║  Storage: DynamoDB (local)"
  : "║  Storage: In-memory (set DYNAMODB_ENDPOINT for local DynamoDB)";

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                      CASFA Local Server                      ║
╠══════════════════════════════════════════════════════════════╣
║  URL: http://localhost:${String(PORT).padEnd(38)}║
║                                                              ║
${authInfo}
║                                                              ║
${storageInfo.padEnd(58)}║
║  Endpoints:                                                  ║
║    GET  /api/health             - Health check               ║
║    GET  /api/oauth/config       - Cognito config             ║
║    GET  /api/oauth/me           - Current user info          ║
║    GET  /api/auth/clients       - List AWP clients           ║
║    GET  /api/auth/tokens        - List agent tokens          ║
║    POST /api/auth/ticket        - Create ticket              ║
║    GET  /api/admin/users        - List users (admin)         ║
║    */api/realm/{realmId}/...   - Realm operations (auth)    ║
║    */api/ticket/{ticketId}/... - Ticket operations (no auth)║
╚══════════════════════════════════════════════════════════════╝
`);

Bun.serve({
  port: PORT,
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    console.log(`[${new Date().toISOString()}] ${req.method} ${path}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    try {
      // All API routes under /api prefix
      if (!path.startsWith("/api/")) {
        return errorResponse(404, "Not found");
      }

      // Strip /api prefix for internal routing
      const apiPath = path.slice(4); // Remove "/api"

      // Health check
      if (apiPath === "/health") {
        return jsonResponse(200, { status: "ok", service: "casfa-local" });
      }

      // OAuth routes (login/authentication)
      if (apiPath.startsWith("/oauth/")) {
        return handleOAuth(req, apiPath.replace("/oauth", ""));
      }

      // Auth routes (authorization)
      if (apiPath.startsWith("/auth/")) {
        return handleAuth(req, apiPath.replace("/auth", ""));
      }

      // Admin routes
      if (apiPath.startsWith("/admin/")) {
        return handleAdmin(req, apiPath.replace("/admin", ""));
      }

      // Realm routes (same as CAS routes, just different path format)
      const realmMatch = apiPath.match(/^\/realm\/([^/]+)(.*)$/);
      if (realmMatch) {
        const [, realmId, subPath] = realmMatch;
        return handleRealm(req, realmId!, subPath ?? "");
      }

      // CAS routes (legacy)
      const casMatch = apiPath.match(/^\/cas\/([^/]+)(.*)$/);
      if (casMatch) {
        const [, scope, subPath] = casMatch;
        return handleCas(req, scope!, subPath ?? "");
      }

      return errorResponse(404, "Not found");
    } catch (error: any) {
      console.error("Server error:", error);
      return errorResponse(500, error.message ?? "Internal server error");
    }
  },
});
