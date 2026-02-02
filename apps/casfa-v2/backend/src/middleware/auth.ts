/**
 * Authentication Middleware for Hono
 *
 * Supports:
 * 1. Bearer Token (Agent Token / Ticket)
 * 2. Bearer JWT (Cognito Access Token)
 * 3. AWP Signed Requests (ECDSA P-256)
 */

import { createHash } from "node:crypto"
import type { MiddlewareHandler } from "hono"
import { createRemoteJWKSet, jwtVerify } from "jose"
import { AWP_AUTH_HEADERS, validateTimestamp, verifySignature } from "@agent-web-portal/auth"
import type { TokensDb } from "../db/tokens.ts"
import type { UserRolesDb } from "../db/user-roles.ts"
import type { AwpPubkeysDb } from "../db/awp-pubkeys.ts"
import type { AuthContext, Env, Token, UserRole, AgentToken, Ticket } from "../types.ts"
import type { CognitoConfig } from "../config.ts"

// ============================================================================
// Types
// ============================================================================

export type AuthMiddlewareDeps = {
  tokensDb: TokensDb
  userRolesDb: UserRolesDb
  awpPubkeysDb: AwpPubkeysDb
  cognitoConfig: CognitoConfig
}

// ============================================================================
// Middleware Factory
// ============================================================================

export const createAuthMiddleware = (deps: AuthMiddlewareDeps): MiddlewareHandler<Env> => {
  const { tokensDb, userRolesDb, awpPubkeysDb, cognitoConfig } = deps

  // JWKS for Cognito JWT verification
  const jwksUrl = cognitoConfig.userPoolId
    ? `https://cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}/.well-known/jwks.json`
    : null
  const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null

  const applyUserRole = async (auth: AuthContext): Promise<AuthContext> => {
    if (!auth.userId) return auth

    const role = await userRolesDb.getRole(auth.userId)
    auth.role = role

    if (role === "unauthorized") {
      auth.canRead = false
      auth.canWrite = false
      auth.canIssueTicket = false
      auth.canManageUsers = false
    } else if (role === "authorized") {
      auth.canRead = true
      auth.canWrite = true
      auth.canIssueTicket = true
      auth.canManageUsers = false
    } else {
      // admin
      auth.canRead = true
      auth.canWrite = true
      auth.canIssueTicket = true
      auth.canManageUsers = true
    }

    return auth
  }

  const authenticateBearer = async (authHeader: string): Promise<AuthContext | null> => {
    const parts = authHeader.split(" ")
    if (parts.length !== 2) return null

    const [scheme, tokenValue] = parts

    // Agent Token: "Agent {token}"
    if (scheme === "Agent" && tokenValue) {
      const token = await tokensDb.getToken(tokenValue)
      if (!token || token.type !== "agent") return null

      const agentToken = token as AgentToken
      const auth: AuthContext = {
        token,
        userId: agentToken.userId,
        realm: `usr_${agentToken.userId}`,
        canRead: true,
        canWrite: true,
        canIssueTicket: true,
      }
      return applyUserRole(auth)
    }

    // Bearer JWT or stored token
    if (scheme === "Bearer" && tokenValue) {
      // Try as stored token first
      const storedToken = await tokensDb.getToken(tokenValue)
      if (storedToken) {
        if (storedToken.type === "user") {
          const auth: AuthContext = {
            token: storedToken,
            userId: storedToken.userId,
            realm: `usr_${storedToken.userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
          }
          return applyUserRole(auth)
        }
        if (storedToken.type === "agent") {
          const agentToken = storedToken as AgentToken
          const auth: AuthContext = {
            token: storedToken,
            userId: agentToken.userId,
            realm: `usr_${agentToken.userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
          }
          return applyUserRole(auth)
        }
      }

      // Try as Cognito JWT
      if (jwks && tokenValue) {
        try {
          const { payload } = await jwtVerify(tokenValue, jwks, {
            issuer: `https://cognito-idp.${cognitoConfig.region}.amazonaws.com/${cognitoConfig.userPoolId}`,
          })

          const userId = payload.sub
          if (!userId) return null

          const syntheticToken: Token = {
            pk: `token#jwt_${userId}`,
            type: "user",
            userId,
            createdAt: Date.now(),
            expiresAt: (payload.exp ?? 0) * 1000,
          }

          const auth: AuthContext = {
            token: syntheticToken,
            userId,
            realm: `usr_${userId}`,
            canRead: true,
            canWrite: true,
            canIssueTicket: true,
          }
          return applyUserRole(auth)
        } catch {
          // JWT verification failed
        }
      }
    }

    return null
  }

  const authenticateAwp = async (
    pubkey: string,
    timestamp: string,
    signature: string,
    method: string,
    path: string,
    body: string
  ): Promise<AuthContext | null> => {
    // Validate timestamp
    if (!validateTimestamp(timestamp, 300)) {
      return null
    }

    // Look up pubkey
    const authorizedPubkey = await awpPubkeysDb.lookup(pubkey)
    if (!authorizedPubkey) return null

    // Build signature payload
    const bodyHash = body ? createHash("sha256").update(body).digest("hex") : ""
    const payload = `${timestamp}.${method}.${path}.${bodyHash}`

    // Verify signature
    const isValid = await verifySignature(pubkey, payload, signature)
    if (!isValid) return null

    const userId = authorizedPubkey.userId
    const syntheticToken: Token = {
      pk: `token#awp_${userId}`,
      type: "user",
      userId,
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
    }

    const auth: AuthContext = {
      token: syntheticToken,
      userId,
      realm: `usr_${userId}`,
      canRead: true,
      canWrite: true,
      canIssueTicket: true,
    }

    return applyUserRole(auth)
  }

  return async (c, next) => {
    // Check for AWP signed request first
    const awpPubkey = c.req.header(AWP_AUTH_HEADERS.pubkey)
    if (awpPubkey) {
      const timestamp = c.req.header(AWP_AUTH_HEADERS.timestamp)
      const signature = c.req.header(AWP_AUTH_HEADERS.signature)

      if (timestamp && signature) {
        const body = await c.req.text()
        const auth = await authenticateAwp(
          awpPubkey,
          timestamp,
          signature,
          c.req.method,
          c.req.path,
          body
        )

        if (auth) {
          c.set("auth", auth)
          return next()
        }
      }
    }

    // Try Bearer token auth
    const authHeader = c.req.header("Authorization")
    if (authHeader) {
      const auth = await authenticateBearer(authHeader)
      if (auth) {
        c.set("auth", auth)
        return next()
      }
    }

    return c.json({ error: "Unauthorized" }, 401)
  }
}

/**
 * Optional auth middleware - doesn't reject if no auth
 */
export const createOptionalAuthMiddleware = (
  deps: AuthMiddlewareDeps
): MiddlewareHandler<Env> => {
  const authMiddleware = createAuthMiddleware(deps)

  return async (c, next) => {
    // Check if there's any auth header
    const authHeader = c.req.header("Authorization")
    const awpPubkey = c.req.header(AWP_AUTH_HEADERS.pubkey)

    if (!authHeader && !awpPubkey) {
      return next()
    }

    // Try to authenticate but don't fail if it doesn't work
    try {
      await authMiddleware(c, next)
    } catch {
      return next()
    }
  }
}
