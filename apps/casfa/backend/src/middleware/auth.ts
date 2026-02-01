/**
 * CAS Stack - Authentication Middleware
 *
 * Supports three authentication methods:
 * 1. Bearer Token (Agent Token / Ticket) - Token stored in database
 * 2. Bearer JWT (Cognito Access Token) - JWT from Cognito User Pool
 * 3. AWP Signed Requests - ECDSA P-256 signature-based auth for AI agents
 */

import { createHash } from "node:crypto";
import type { PubkeyStore } from "@agent-web-portal/auth";
import { AWP_AUTH_HEADERS, validateTimestamp, verifySignature } from "@agent-web-portal/auth";
import { TokensDb } from "../db/tokens.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { AuthContext, CasConfig, HttpRequest, Token, UserRole } from "../types.ts";

export class AuthMiddleware {
  private config: CasConfig;
  private tokensDb: TokensDb;
  private userRolesDb: UserRolesDb | null;
  private awpPubkeyStore: PubkeyStore | null;

  constructor(
    config: CasConfig,
    tokensDb?: TokensDb,
    awpPubkeyStore?: PubkeyStore,
    userRolesDb?: UserRolesDb
  ) {
    this.config = config;
    this.tokensDb = tokensDb ?? new TokensDb(config);
    this.userRolesDb = userRolesDb ?? null;
    this.awpPubkeyStore = awpPubkeyStore ?? null;
  }

  /**
   * Apply user role to auth context (for user/agent/AWP). Tickets are unchanged.
   * Also ensures user exists in DB so admins can see and authorize them.
   */
  private async applyUserRole(auth: AuthContext): Promise<AuthContext> {
    if (!auth.userId) return auth; // ticket or similar
    const userRolesDb = this.userRolesDb;
    if (!userRolesDb) {
      // No role DB: treat as authorized (backward compat when not wired)
      auth.role = "authorized";
      auth.canManageUsers = false;
      return auth;
    }
    // Ensure user record exists (so admin can see all logged-in users)
    await userRolesDb.ensureUser(auth.userId);
    const role: UserRole = await userRolesDb.getRole(auth.userId);
    auth.role = role;
    if (role === "unauthorized") {
      auth.canRead = false;
      auth.canWrite = false;
      auth.canIssueTicket = false;
      auth.canManageUsers = false;
    } else if (role === "authorized") {
      auth.canRead = true;
      auth.canWrite = true;
      auth.canIssueTicket = true;
      auth.canManageUsers = false;
    } else {
      auth.canRead = true;
      auth.canWrite = true;
      auth.canIssueTicket = true;
      auth.canManageUsers = true;
    }
    return auth;
  }

  /**
   * Parse Authorization header and validate token, or verify AWP signed request
   */
  async authenticate(req: HttpRequest): Promise<AuthContext | null> {
    // First, check for AWP signed request
    if (this.hasAwpCredentials(req) && this.awpPubkeyStore) {
      return this.authenticateAwp(req);
    }

    // Fall back to Bearer token auth
    return this.authenticateBearer(req);
  }

  /**
   * Check if request has AWP authentication credentials
   */
  private hasAwpCredentials(req: HttpRequest): boolean {
    const pubkey =
      req.headers[AWP_AUTH_HEADERS.pubkey.toLowerCase()] ?? req.headers[AWP_AUTH_HEADERS.pubkey];
    return !!pubkey;
  }

  /**
   * Authenticate using AWP signed request
   */
  private async authenticateAwp(req: HttpRequest): Promise<AuthContext | null> {
    if (!this.awpPubkeyStore) {
      console.log("[Auth] AWP auth failed: No pubkey store configured");
      return null;
    }

    const pubkey =
      req.headers[AWP_AUTH_HEADERS.pubkey.toLowerCase()] ?? req.headers[AWP_AUTH_HEADERS.pubkey];
    const timestamp =
      req.headers[AWP_AUTH_HEADERS.timestamp.toLowerCase()] ??
      req.headers[AWP_AUTH_HEADERS.timestamp];
    const signature =
      req.headers[AWP_AUTH_HEADERS.signature.toLowerCase()] ??
      req.headers[AWP_AUTH_HEADERS.signature];

    if (!pubkey || !timestamp || !signature) {
      console.log("[Auth] AWP auth failed: Missing headers", {
        pubkey: !!pubkey,
        timestamp: !!timestamp,
        signature: !!signature,
      });
      return null;
    }

    console.log("[Auth] AWP auth attempt for pubkey:", `${pubkey.substring(0, 20)}...`);

    // Validate timestamp
    if (!validateTimestamp(timestamp, 300)) {
      // 5 minute max clock skew
      console.log("[Auth] AWP auth failed: Timestamp validation failed", {
        timestamp,
        now: Math.floor(Date.now() / 1000),
      });
      return null;
    }

    // Look up the pubkey
    const authorizedPubkey = await this.awpPubkeyStore.lookup(pubkey);
    if (!authorizedPubkey) {
      console.log("[Auth] AWP auth failed: Pubkey not found in store");
      return null;
    }

    console.log("[Auth] AWP pubkey found for user:", authorizedPubkey.userId);

    // Verify the signature
    // Convert HttpRequest body to string
    // Note: The handler already decodes base64, so we just need to convert Buffer to string
    const body =
      typeof req.body === "string" ? req.body : req.body ? req.body.toString("utf-8") : "";

    // Build signature payload: timestamp.METHOD.path.bodyHash
    // Use originalPath for signature verification (preserves /api prefix)
    const queryString =
      Object.keys(req.query).length > 0
        ? `?${new URLSearchParams(req.query as Record<string, string>).toString()}`
        : "";
    const signaturePath = (req.originalPath ?? req.path) + queryString;

    // Body hash must be base64url encoded (same as client)
    const hashBuffer = createHash("sha256").update(body).digest();
    const bodyHash = hashBuffer.toString("base64url");
    const signaturePayload = `${timestamp}.${req.method.toUpperCase()}.${signaturePath}.${bodyHash}`;

    console.log("[Auth] AWP signature verification:", {
      signaturePath,
      method: req.method,
      bodyLength: body.length,
      bodyHash,
      signaturePayload,
    });

    const isValid = await verifySignature(pubkey, signaturePayload, signature);

    if (!isValid) {
      console.log("[Auth] AWP auth failed: Signature verification failed");
      return null;
    }

    console.log("[Auth] AWP auth successful for user:", authorizedPubkey.userId);

    const ctx = this.buildAwpAuthContext(authorizedPubkey);
    return this.applyUserRole(ctx);
  }

  /**
   * Build AuthContext from authorized AWP pubkey
   */
  private buildAwpAuthContext(auth: {
    userId: string;
    pubkey: string;
    clientName: string;
  }): AuthContext {
    return {
      token: {
        pk: `awp#${auth.pubkey}`,
        type: "user", // AWP clients have user-level access
        userId: auth.userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
      },
      userId: auth.userId,
      realm: `usr_${auth.userId}`,
      canRead: true,
      canWrite: true,
      canIssueTicket: true,
    };
  }

  /**
   * Authenticate using Bearer token
   */
  private async authenticateBearer(req: HttpRequest): Promise<AuthContext | null> {
    const authHeader = req.headers.authorization ?? req.headers.Authorization;
    if (!authHeader) {
      return null;
    }

    // Parse header: "Bearer xxx", "Ticket xxx", or "Agent xxx"
    const [scheme, tokenValue] = authHeader.split(" ");
    if (!scheme || !tokenValue) {
      return null;
    }

    const normalizedScheme = scheme.toLowerCase();
    if (
      normalizedScheme !== "bearer" &&
      normalizedScheme !== "ticket" &&
      normalizedScheme !== "agent"
    ) {
      return null;
    }

    // Check if it looks like a JWT (has 3 parts separated by dots)
    if (normalizedScheme === "bearer" && tokenValue.split(".").length === 3) {
      return this.authenticateJwt(tokenValue);
    }

    // Get token from database
    const token = await this.tokensDb.getToken(tokenValue);
    if (!token) {
      return null;
    }

    const ctx = this.buildAuthContext(token);
    if (token.type === "ticket") return ctx;
    return this.applyUserRole(ctx);
  }

  /**
   * Authenticate using Cognito JWT token
   */
  private async authenticateJwt(jwt: string): Promise<AuthContext | null> {
    try {
      // Decode JWT payload (base64url encoded)
      const parts = jwt.split(".");
      if (parts.length !== 3) {
        return null;
      }

      const payloadBase64 = parts[1]!;
      // Convert base64url to base64
      const base64 = payloadBase64.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(Buffer.from(base64, "base64").toString("utf-8"));

      // Validate token issuer
      const expectedIssuer = `https://cognito-idp.${this.config.cognitoRegion}.amazonaws.com/${this.config.cognitoUserPoolId}`;
      if (payload.iss !== expectedIssuer) {
        console.error("[Auth] JWT issuer mismatch:", payload.iss, "expected:", expectedIssuer);
        return null;
      }

      // Validate token is not expired
      const now = Math.floor(Date.now() / 1000);
      if (payload.exp && payload.exp < now) {
        console.error("[Auth] JWT expired");
        return null;
      }

      // Validate token type (access token)
      if (payload.token_use !== "access") {
        console.error("[Auth] JWT is not an access token:", payload.token_use);
        return null;
      }

      // Get user ID from sub claim
      const userId = payload.sub;
      if (!userId) {
        console.error("[Auth] JWT missing sub claim");
        return null;
      }

      const ctx: AuthContext = {
        token: {
          pk: `jwt#${userId}`,
          type: "user",
          userId,
          createdAt: (payload.iat || now) * 1000,
          expiresAt: (payload.exp || now + 3600) * 1000,
        },
        userId,
        realm: `usr_${userId}`,
        canRead: true,
        canWrite: true,
        canIssueTicket: true,
      };
      return this.applyUserRole(ctx);
    } catch (error) {
      console.error("[Auth] JWT decode error:", error);
      return null;
    }
  }

  /**
   * Build AuthContext from token
   */
  private buildAuthContext(token: Token): AuthContext {
    switch (token.type) {
      case "user":
        return {
          token,
          userId: token.userId,
          realm: `usr_${token.userId}`,
          canRead: true,
          canWrite: true,
          canIssueTicket: true,
        };

      case "agent":
        // Agent tokens inherit all permissions from user
        return {
          token,
          userId: token.userId,
          realm: `usr_${token.userId}`,
          canRead: true,
          canWrite: true,
          canIssueTicket: true,
        };

      case "ticket":
        return {
          token,
          userId: "", // Tickets don't have direct user context
          realm: token.realm,
          canRead: true, // Tickets always have read access to scope
          canWrite: !!token.writable && !token.written, // Can write if writable and not already written
          canIssueTicket: false,
          allowedScope: token.scope,
        };
    }
  }

  /**
   * Authenticate directly by ticket ID (for ticket URL paths)
   */
  async authenticateByTicketId(ticketId: string): Promise<AuthContext | null> {
    const token = await this.tokensDb.getToken(ticketId);
    if (!token || token.type !== "ticket") {
      return null;
    }
    return this.buildAuthContext(token);
  }

  /**
   * Check if auth context can access the requested realm
   */
  checkRealmAccess(auth: AuthContext, requestedRealm: string): boolean {
    // Check if auth realm matches requested realm
    return auth.realm === requestedRealm;
  }

  /**
   * Check if auth context can read a specific key
   * For tickets, the key must be within the allowed scope (DAG roots)
   */
  checkReadAccess(auth: AuthContext, key: string): boolean {
    if (!auth.canRead) {
      return false;
    }

    // Tickets are restricted to their scope (DAG roots)
    if (auth.allowedScope) {
      return this.isKeyInScope(key, auth.allowedScope);
    }

    return true;
  }

  /**
   * Check if a key is within the allowed scope
   * Note: This is a simplified check. Full DAG traversal would be needed
   * to verify if a key is a descendant of one of the scope roots.
   */
  private isKeyInScope(key: string, scope: string | string[]): boolean {
    const scopeArray = Array.isArray(scope) ? scope : [scope];
    // For now, check if key is one of the scope roots
    // TODO: Implement full DAG traversal check
    return scopeArray.includes(key);
  }

  /**
   * Check if auth context can write
   */
  checkWriteAccess(auth: AuthContext): boolean {
    return auth.canWrite;
  }

  /**
   * Check if ticket has writable quota available
   */
  checkWritableQuota(auth: AuthContext, size: number): boolean {
    if (!auth.canWrite) {
      return false;
    }

    if (auth.token.type !== "ticket") {
      return true; // User tokens have no quota
    }

    const ticket = auth.token;
    if (typeof ticket.writable === "object" && ticket.writable.quota) {
      return size <= ticket.writable.quota;
    }

    return true;
  }

  /**
   * Check if content type is accepted by the ticket
   */
  checkAcceptedMimeType(auth: AuthContext, contentType: string): boolean {
    if (auth.token.type !== "ticket") {
      return true; // User tokens accept all types
    }

    const ticket = auth.token;
    if (typeof ticket.writable === "object" && ticket.writable.accept) {
      return this.matchMimeType(contentType, ticket.writable.accept);
    }

    return true;
  }

  /**
   * Check if content type matches any of the accepted patterns
   */
  private matchMimeType(contentType: string, acceptPatterns: string[]): boolean {
    for (const pattern of acceptPatterns) {
      if (pattern === "*/*" || pattern === contentType) {
        return true;
      }
      // Handle wildcards like "image/*"
      if (pattern.endsWith("/*")) {
        const prefix = pattern.slice(0, -1); // "image/"
        if (contentType.startsWith(prefix)) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Resolve realm - returns the realm as-is (aliases removed)
   * @deprecated No longer needed as aliases are not supported. Use requestedRealm directly.
   */
  resolveRealm(auth: AuthContext, requestedRealm: string): string {
    return requestedRealm;
  }

  /**
   * @deprecated Use checkRealmAccess instead
   */
  checkScopeAccess(auth: AuthContext, requestedScope: string): boolean {
    return this.checkRealmAccess(auth, requestedScope);
  }

  /**
   * @deprecated Use requestedRealm directly instead
   */
  resolveScope(auth: AuthContext, requestedScope: string): string {
    return requestedScope;
  }
}
