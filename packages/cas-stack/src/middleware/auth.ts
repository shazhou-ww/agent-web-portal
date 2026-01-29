/**
 * CAS Stack - Authentication Middleware
 *
 * Supports two authentication methods:
 * 1. Bearer Token (User Token / Ticket) - Traditional token-based auth
 * 2. AWP Signed Requests - ECDSA P-256 signature-based auth for AI agents
 */

import type { AuthContext, Token, HttpRequest, CasConfig } from "../types.ts";
import { TokensDb } from "../db/tokens.ts";
import { verifySignature, validateTimestamp, AWP_AUTH_HEADERS } from "@agent-web-portal/auth";
import type { PubkeyStore } from "@agent-web-portal/auth";
import { createHash } from "crypto";

export class AuthMiddleware {
  private tokensDb: TokensDb;
  private awpPubkeyStore: PubkeyStore | null;

  constructor(config: CasConfig, tokensDb?: TokensDb, awpPubkeyStore?: PubkeyStore) {
    this.tokensDb = tokensDb ?? new TokensDb(config);
    this.awpPubkeyStore = awpPubkeyStore ?? null;
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
    const pubkey = req.headers[AWP_AUTH_HEADERS.pubkey.toLowerCase()] ??
                   req.headers[AWP_AUTH_HEADERS.pubkey];
    return !!pubkey;
  }

  /**
   * Authenticate using AWP signed request
   */
  private async authenticateAwp(req: HttpRequest): Promise<AuthContext | null> {
    if (!this.awpPubkeyStore) {
      return null;
    }

    const pubkey = req.headers[AWP_AUTH_HEADERS.pubkey.toLowerCase()] ??
                   req.headers[AWP_AUTH_HEADERS.pubkey];
    const timestamp = req.headers[AWP_AUTH_HEADERS.timestamp.toLowerCase()] ??
                      req.headers[AWP_AUTH_HEADERS.timestamp];
    const signature = req.headers[AWP_AUTH_HEADERS.signature.toLowerCase()] ??
                      req.headers[AWP_AUTH_HEADERS.signature];

    if (!pubkey || !timestamp || !signature) {
      return null;
    }

    // Validate timestamp
    if (!validateTimestamp(timestamp, 300)) { // 5 minute max clock skew
      return null;
    }

    // Look up the pubkey
    const authorizedPubkey = await this.awpPubkeyStore.lookup(pubkey);
    if (!authorizedPubkey) {
      return null;
    }

    // Verify the signature
    // Convert HttpRequest body to string
    const body = typeof req.body === 'string' ? req.body : 
                 req.body ? (req.isBase64Encoded ? 
                   Buffer.from(req.body.toString(), 'base64').toString('utf-8') : 
                   req.body.toString('utf-8')) : '';

    // Build signature payload: timestamp.METHOD.path.bodyHash
    const path = req.path + (Object.keys(req.query).length > 0 ? 
      '?' + new URLSearchParams(req.query as Record<string, string>).toString() : '');
    const bodyHash = createHash("sha256").update(body).digest("hex");
    const signaturePayload = `${timestamp}.${req.method.toUpperCase()}.${path}.${bodyHash}`;

    const isValid = await verifySignature(pubkey, signaturePayload, signature);

    if (!isValid) {
      return null;
    }

    // Build auth context for AWP client
    return this.buildAwpAuthContext(authorizedPubkey);
  }

  /**
   * Build AuthContext from authorized AWP pubkey
   */
  private buildAwpAuthContext(auth: { userId: string; pubkey: string; clientName: string }): AuthContext {
    return {
      token: {
        pk: `awp#${auth.pubkey}`,
        type: "user", // AWP clients have user-level access
        userId: auth.userId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600000, // 1 hour
      },
      userId: auth.userId,
      scope: `usr_${auth.userId}`,
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

    // Parse header: "Bearer xxx" or "Ticket xxx"
    const [scheme, tokenId] = authHeader.split(" ");
    if (!scheme || !tokenId) {
      return null;
    }

    const normalizedScheme = scheme.toLowerCase();
    if (normalizedScheme !== "bearer" && normalizedScheme !== "ticket") {
      return null;
    }

    // Get token from database
    const token = await this.tokensDb.getToken(tokenId);
    if (!token) {
      return null;
    }

    // Build auth context based on token type
    return this.buildAuthContext(token);
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
          scope: `usr_${token.userId}`,
          canRead: true,
          canWrite: true,
          canIssueTicket: true,
        };

      case "ticket":
        return {
          token,
          userId: "", // Tickets don't have direct user context
          scope: token.scope,
          canRead: token.ticketType === "read",
          canWrite: token.ticketType === "write",
          canIssueTicket: false,
          allowedKey: token.key,
        };
    }
  }

  /**
   * Check if auth context can access the requested scope
   */
  checkScopeAccess(auth: AuthContext, requestedScope: string): boolean {
    // Resolve @me alias
    const effectiveScope =
      requestedScope === "@me" ? auth.scope : requestedScope;

    // Check if auth scope matches requested scope
    return auth.scope === effectiveScope;
  }

  /**
   * Check if auth context can read a specific key
   */
  checkReadAccess(auth: AuthContext, key: string): boolean {
    if (!auth.canRead) {
      return false;
    }

    // Read tickets may be restricted to specific keys
    if (auth.allowedKey && auth.allowedKey !== key) {
      return false;
    }

    return true;
  }

  /**
   * Check if auth context can write
   */
  checkWriteAccess(auth: AuthContext): boolean {
    return auth.canWrite;
  }

  /**
   * Resolve scope alias (@me -> actual scope)
   */
  resolveScope(auth: AuthContext, requestedScope: string): string {
    return requestedScope === "@me" ? auth.scope : requestedScope;
  }
}
