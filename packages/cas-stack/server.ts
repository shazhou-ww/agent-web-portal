/**
 * CAS Stack - Local Development Server (Bun)
 *
 * Uses in-memory storage for local development without AWS dependencies.
 * Supports Cognito JWT authentication for cas-webui integration.
 */

import { createHash } from "crypto";
import { createRemoteJWKSet, jwtVerify } from "jose";
import type {
  CasConfig,
  HttpRequest,
  HttpResponse,
  Token,
  UserToken,
  Ticket,
  CasOwnership,
  CasDagNode,
} from "./src/types.ts";
import type { PendingAuth, AuthorizedPubkey, PendingAuthStore, PubkeyStore } from "@agent-web-portal/auth";
import { generateVerificationCode, verifySignature, validateTimestamp, AWP_AUTH_HEADERS } from "@agent-web-portal/auth";
import { createHash as cryptoCreateHash } from "crypto";

// ============================================================================
// In-Memory Storage
// ============================================================================

class MemoryTokensDb {
  private tokens = new Map<string, Token>();

  async getToken(tokenId: string): Promise<Token | null> {
    const token = this.tokens.get(`token#${tokenId}`);
    if (!token) return null;
    if (token.expiresAt < Date.now()) {
      this.tokens.delete(`token#${tokenId}`);
      return null;
    }
    return token;
  }

  async createUserToken(
    userId: string,
    refreshToken: string,
    expiresIn: number = 3600
  ): Promise<UserToken> {
    const tokenId = `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const token: UserToken = {
      pk: `token#${tokenId}`,
      type: "user",
      userId,
      refreshToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(token.pk, token);
    return token;
  }

  async createTicket(
    scope: string,
    issuerId: string,
    ticketType: "read" | "write",
    key?: string,
    expiresIn?: number
  ): Promise<Ticket> {
    const ticketId = `tkt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const defaultExpiry = ticketType === "read" ? 3600 : 300;
    const ticket: Ticket = {
      pk: `token#${ticketId}`,
      type: "ticket",
      scope,
      issuerId,
      ticketType,
      key,
      createdAt: Date.now(),
      expiresAt: Date.now() + (expiresIn ?? defaultExpiry) * 1000,
    };
    this.tokens.set(ticket.pk, ticket);
    return ticket;
  }

  async deleteToken(tokenId: string): Promise<void> {
    this.tokens.delete(`token#${tokenId}`);
  }

  async verifyTokenOwnership(tokenId: string, userId: string): Promise<boolean> {
    const token = await this.getToken(tokenId);
    if (!token) return false;
    if (token.type === "user") {
      return token.userId === userId;
    }
    if (token.type === "ticket") {
      const issuer = await this.getToken(token.issuerId);
      if (!issuer) return false;
      if (issuer.type === "user") {
        return issuer.userId === userId;
      }
    }
    return false;
  }

  static extractTokenId(pk: string): string {
    return pk.replace("token#", "");
  }
}

class MemoryOwnershipDb {
  private ownership = new Map<string, CasOwnership>();

  private key(scope: string, casKey: string): string {
    return `${scope}#${casKey}`;
  }

  async hasOwnership(scope: string, casKey: string): Promise<boolean> {
    return this.ownership.has(this.key(scope, casKey));
  }

  async getOwnership(scope: string, casKey: string): Promise<CasOwnership | null> {
    return this.ownership.get(this.key(scope, casKey)) ?? null;
  }

  async checkOwnership(
    scope: string,
    keys: string[]
  ): Promise<{ found: string[]; missing: string[] }> {
    const found: string[] = [];
    const missing: string[] = [];
    for (const k of keys) {
      if (this.ownership.has(this.key(scope, k))) {
        found.push(k);
      } else {
        missing.push(k);
      }
    }
    return { found, missing };
  }

  async addOwnership(
    scope: string,
    casKey: string,
    createdBy: string,
    contentType: string,
    size: number
  ): Promise<CasOwnership> {
    const record: CasOwnership = {
      scope,
      key: casKey,
      createdAt: Date.now(),
      createdBy,
      contentType,
      size,
    };
    this.ownership.set(this.key(scope, casKey), record);
    return record;
  }

  async listNodes(
    scope: string,
    limit: number = 10,
    startKey?: string
  ): Promise<{ nodes: CasOwnership[]; nextKey?: string; total: number }> {
    // Get all nodes for this scope
    const allNodes: CasOwnership[] = [];
    for (const record of this.ownership.values()) {
      if (record.scope === scope) {
        allNodes.push(record);
      }
    }

    // Sort by createdAt descending (newest first)
    allNodes.sort((a, b) => b.createdAt - a.createdAt);

    // Find start position
    let startIndex = 0;
    if (startKey) {
      const idx = allNodes.findIndex((n) => n.key === startKey);
      if (idx !== -1) {
        startIndex = idx + 1;
      }
    }

    // Paginate
    const nodes = allNodes.slice(startIndex, startIndex + limit);
    const nextKey = nodes.length === limit && startIndex + limit < allNodes.length
      ? nodes[nodes.length - 1]?.key
      : undefined;

    return { nodes, nextKey, total: allNodes.length };
  }

  async deleteOwnership(scope: string, casKey: string): Promise<boolean> {
    return this.ownership.delete(this.key(scope, casKey));
  }
}

class MemoryDagDb {
  private nodes = new Map<string, CasDagNode>();

  async getNode(key: string): Promise<CasDagNode | null> {
    return this.nodes.get(key) ?? null;
  }

  async putNode(
    key: string,
    children: string[],
    contentType: string,
    size: number
  ): Promise<CasDagNode> {
    const node: CasDagNode = {
      key,
      children,
      contentType,
      size,
      createdAt: Date.now(),
    };
    this.nodes.set(key, node);
    return node;
  }

  async collectDagKeys(rootKey: string): Promise<string[]> {
    const visited = new Set<string>();
    const queue = [rootKey];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const node = this.nodes.get(key);
      if (node?.children) {
        for (const child of node.children) {
          if (!visited.has(child)) queue.push(child);
        }
      }
    }
    return Array.from(visited);
  }
}

class MemoryCasStorage {
  private blobs = new Map<string, { content: Buffer; contentType: string }>();

  static computeHash(content: Buffer): string {
    const hash = createHash("sha256").update(content).digest("hex");
    return `sha256:${hash}`;
  }

  async exists(casKey: string): Promise<boolean> {
    return this.blobs.has(casKey);
  }

  async get(casKey: string): Promise<{ content: Buffer; contentType: string } | null> {
    return this.blobs.get(casKey) ?? null;
  }

  async put(
    content: Buffer,
    contentType: string = "application/octet-stream"
  ): Promise<{ key: string; size: number; isNew: boolean }> {
    const key = MemoryCasStorage.computeHash(content);
    const isNew = !this.blobs.has(key);
    if (isNew) {
      this.blobs.set(key, { content, contentType });
    }
    return { key, size: content.length, isNew };
  }

  async putWithKey(
    expectedKey: string,
    content: Buffer,
    contentType: string = "application/octet-stream"
  ): Promise<
    | { key: string; size: number; isNew: boolean }
    | { error: "hash_mismatch"; expected: string; actual: string }
  > {
    const actualKey = MemoryCasStorage.computeHash(content);
    if (actualKey !== expectedKey) {
      return { error: "hash_mismatch", expected: expectedKey, actual: actualKey };
    }
    return this.put(content, contentType);
  }
}

// ============================================================================
// AWP Auth Stores (In-Memory for development)
// ============================================================================

class MemoryAwpPendingAuthStore implements PendingAuthStore {
  private pending = new Map<string, PendingAuth>();

  async create(auth: PendingAuth): Promise<void> {
    this.pending.set(auth.pubkey, auth);
  }

  async get(pubkey: string): Promise<PendingAuth | null> {
    const auth = this.pending.get(pubkey);
    if (!auth) return null;
    if (auth.expiresAt < Date.now()) {
      this.pending.delete(pubkey);
      return null;
    }
    return auth;
  }

  async delete(pubkey: string): Promise<void> {
    this.pending.delete(pubkey);
  }

  async validateCode(pubkey: string, code: string): Promise<boolean> {
    const auth = await this.get(pubkey);
    if (!auth) return false;
    return auth.verificationCode === code;
  }
}

class MemoryAwpPubkeyStore implements PubkeyStore {
  private pubkeys = new Map<string, AuthorizedPubkey>();

  async lookup(pubkey: string): Promise<AuthorizedPubkey | null> {
    const auth = this.pubkeys.get(pubkey);
    if (!auth) return null;
    if (auth.expiresAt && auth.expiresAt < Date.now()) {
      this.pubkeys.delete(pubkey);
      return null;
    }
    return auth;
  }

  async store(auth: AuthorizedPubkey): Promise<void> {
    this.pubkeys.set(auth.pubkey, auth);
  }

  async revoke(pubkey: string): Promise<void> {
    this.pubkeys.delete(pubkey);
  }

  async listByUser(userId: string): Promise<AuthorizedPubkey[]> {
    const now = Date.now();
    return Array.from(this.pubkeys.values()).filter(
      (a) => a.userId === userId && (!a.expiresAt || a.expiresAt > now)
    );
  }
}

// ============================================================================
// Cognito JWT Verifier (for cas-webui integration)
// ============================================================================

// Cognito configuration from environment
const COGNITO_USER_POOL_ID = process.env.VITE_COGNITO_USER_POOL_ID ?? "";
const COGNITO_REGION = COGNITO_USER_POOL_ID.split("_")[0] ?? "us-east-1";
const COGNITO_ISSUER = COGNITO_USER_POOL_ID
  ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}`
  : "";

// JWKS for Cognito JWT verification
const cognitoJwks = COGNITO_USER_POOL_ID
  ? createRemoteJWKSet(new URL(`${COGNITO_ISSUER}/.well-known/jwks.json`))
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
// Local Router
// ============================================================================

const tokensDb = new MemoryTokensDb();
const ownershipDb = new MemoryOwnershipDb();
const dagDb = new MemoryDagDb();
const casStorage = new MemoryCasStorage();
const pendingAuthStore = new MemoryAwpPendingAuthStore();
const pubkeyStore = new MemoryAwpPubkeyStore();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
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

  const [scheme, tokenValue] = authHeader.split(" ");
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
      const tokenId = MemoryTokensDb.extractTokenId(userToken.pk);
      
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

  const id = MemoryTokensDb.extractTokenId(token.pk);

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
      scope: token.scope,
      canRead: token.ticketType === "read",
      canWrite: token.ticketType === "write",
      canIssueTicket: false,
      tokenId: id,
      allowedKey: token.key,
    };
  }

  return null;
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
  if (!validateTimestamp(timestamp, 300)) { // 5 minute max clock skew
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

async function handleAuth(req: Request, path: string): Promise<Response> {
  // ========================================================================
  // AWP Auth Routes (no auth required for init/status)
  // ========================================================================

  // POST /auth/agent-tokens/init - Start AWP auth flow
  if (req.method === "POST" && path === "/agent-tokens/init") {
    const body = await req.json() as { pubkey?: string; client_name?: string };
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

  // GET /auth/agent-tokens/status - Poll for auth completion
  if (req.method === "GET" && path === "/agent-tokens/status") {
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

  // POST /auth/agent-tokens/complete - Complete authorization (requires user auth)
  if (req.method === "POST" && path === "/agent-tokens/complete") {
    const auth = await authenticate(req);
    if (!auth) {
      return errorResponse(401, "User authentication required");
    }

    const body = await req.json() as { pubkey?: string; verification_code?: string };
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

  // GET /auth/agent-tokens/clients - List authorized AWP clients
  if (req.method === "GET" && path === "/agent-tokens/clients") {
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

  // DELETE /auth/agent-tokens/clients/:pubkey - Revoke AWP client
  const clientRevokeMatch = path.match(/^\/agent-tokens\/clients\/(.+)$/);
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
    const body = await req.json() as { type?: "read" | "write"; key?: string };
    if (!body.type) {
      return errorResponse(400, "Missing type");
    }
    if (body.type === "read" && !body.key) {
      return errorResponse(400, "Read tickets require a key");
    }
    const ticket = await tokensDb.createTicket(auth.scope, auth.tokenId, body.type, body.key);
    const ticketId = MemoryTokensDb.extractTokenId(ticket.pk);
    return jsonResponse(201, {
      id: ticketId,
      type: body.type,
      key: body.key,
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    });
  }

  // DELETE /auth/ticket/:id
  const ticketMatch = path.match(/^\/ticket\/([^\/]+)$/);
  if (req.method === "DELETE" && ticketMatch) {
    const ticketId = ticketMatch[1]!;
    const isOwner = await tokensDb.verifyTokenOwnership(ticketId, auth.userId);
    if (!isOwner) {
      return errorResponse(404, "Ticket not found");
    }
    await tokensDb.deleteToken(ticketId);
    return jsonResponse(200, { success: true });
  }

  return errorResponse(404, "Auth endpoint not found");
}

async function handleCas(req: Request, scope: string, subPath: string): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) {
    return errorResponse(401, "Unauthorized");
  }

  // Resolve @me
  const effectiveScope = scope === "@me" ? auth.scope : scope;
  if (effectiveScope !== auth.scope) {
    return errorResponse(403, "Access denied to this scope");
  }

  // GET /cas/{scope}/nodes - List all nodes in scope
  if (req.method === "GET" && subPath === "/nodes") {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const url = new URL(req.url);
    const limit = parseInt(url.searchParams.get("limit") ?? "10", 10);
    const startKey = url.searchParams.get("startKey") ?? undefined;

    const result = await ownershipDb.listNodes(effectiveScope, limit, startKey);
    return jsonResponse(200, result);
  }

  // POST /cas/{scope}/resolve
  if (req.method === "POST" && subPath === "/resolve") {
    const body = await req.json() as { root?: string; nodes?: string[] };
    if (!body.nodes) {
      return errorResponse(400, "Missing nodes");
    }
    const { missing } = await ownershipDb.checkOwnership(effectiveScope, body.nodes);
    return jsonResponse(200, { missing });
  }

  // PUT /cas/{scope}/node/:key
  const putNodeMatch = subPath.match(/^\/node\/(.+)$/);
  if (req.method === "PUT" && putNodeMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(putNodeMatch[1]!);
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
      contentType,
    });
  }

  // GET /cas/{scope}/node/:key
  const getNodeMatch = subPath.match(/^\/node\/(.+)$/);
  if (req.method === "GET" && getNodeMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getNodeMatch[1]!);

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

    return binaryResponse(blob.content, blob.contentType);
  }

  // DELETE /cas/{scope}/node/:key
  const deleteNodeMatch = subPath.match(/^\/node\/(.+)$/);
  if (req.method === "DELETE" && deleteNodeMatch) {
    if (!auth.canWrite) {
      return errorResponse(403, "Write access denied");
    }
    const key = decodeURIComponent(deleteNodeMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    await ownershipDb.deleteOwnership(effectiveScope, key);
    // Note: We don't delete the actual blob - CAS is immutable, we just remove ownership
    return jsonResponse(200, { success: true, key });
  }

  // GET /cas/{scope}/dag/:key
  const getDagMatch = subPath.match(/^\/dag\/(.+)$/);
  if (req.method === "GET" && getDagMatch) {
    if (!auth.canRead) {
      return errorResponse(403, "Read access denied");
    }
    const key = decodeURIComponent(getDagMatch[1]!);

    const hasAccess = await ownershipDb.hasOwnership(effectiveScope, key);
    if (!hasAccess) {
      return errorResponse(404, "Not found");
    }

    const dagKeys = await dagDb.collectDagKeys(key);
    const nodes: Record<string, { size: number; contentType: string; children: string[] }> = {};

    for (const nodeKey of dagKeys) {
      const meta = await dagDb.getNode(nodeKey);
      if (meta) {
        nodes[nodeKey] = {
          size: meta.size,
          contentType: meta.contentType,
          children: meta.children,
        };
      }
    }

    return jsonResponse(200, { root: key, nodes });
  }

  // POST /cas/{scope}/dag
  if (req.method === "POST" && subPath === "/dag") {
    return errorResponse(501, "Multipart DAG upload not yet implemented");
  }

  return errorResponse(404, "CAS endpoint not found");
}

// ============================================================================
// Server
// ============================================================================

const PORT = parseInt(process.env.CAS_API_PORT ?? process.env.PORT ?? "3550", 10);

if (!COGNITO_USER_POOL_ID) {
  console.error("ERROR: VITE_COGNITO_USER_POOL_ID environment variable is required");
  console.error("Please set it in your .env file");
  process.exit(1);
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    CAS Stack Local Server                    ║
╠══════════════════════════════════════════════════════════════╣
║  URL: http://localhost:${PORT}                                 ║
║                                                              ║
║  Auth: Cognito                                               ║
║    User Pool: ${COGNITO_USER_POOL_ID.padEnd(43)}║
║    Login via cas-webui with your Cognito credentials         ║
║                                                              ║
║  Endpoints:                                                  ║
║    GET  /auth/agent-tokens     - List agent tokens           ║
║    POST /auth/agent-token      - Create agent token          ║
║    POST /auth/ticket           - Create ticket               ║
║    POST /cas/{scope}/resolve   - Check node existence        ║
║    PUT  /cas/{scope}/node/:key - Upload node                 ║
║    GET  /cas/{scope}/node/:key - Download node               ║
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
      // Health check
      if (path === "/" || path === "/health") {
        return jsonResponse(200, { status: "ok", service: "cas-stack-local" });
      }

      // Auth routes
      if (path.startsWith("/auth/")) {
        return handleAuth(req, path.replace("/auth", ""));
      }

      // CAS routes
      const casMatch = path.match(/^\/cas\/([^\/]+)(.*)$/);
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
