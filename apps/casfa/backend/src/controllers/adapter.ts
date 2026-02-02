/**
 * Controller Adapter
 *
 * Adapts between router/server types and controller types.
 * Provides helper functions for converting AuthContext and handling ControllerResult.
 */

import type { AuthContext as RouterAuthContext } from "../types.ts";
import type { AuthContext as ControllerAuthContext, ControllerResult } from "./types.ts";

/**
 * Convert router AuthContext to controller AuthContext
 */
export function toControllerAuth(auth: RouterAuthContext): ControllerAuthContext {
  return {
    userId: auth.userId,
    realm: auth.realm,
    tokenId: extractTokenId(auth.token.pk),
    canRead: auth.canRead,
    canWrite: auth.canWrite,
    canIssueTicket: auth.canIssueTicket,
    canManageUsers: auth.canManageUsers ?? false,
    role: auth.role,
    allowedKeys: auth.allowedScope,
  };
}

/**
 * Extract token ID from pk
 */
function extractTokenId(pk: string): string {
  return pk.replace("token#", "");
}

/**
 * HTTP Response type for adapter
 */
export interface HttpResponse {
  statusCode: number;
  headers?: Record<string, string>;
  body?: string;
  isBase64Encoded?: boolean;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Content-Type,Authorization,X-AWP-Pubkey,X-AWP-Timestamp,X-AWP-Signature",
  "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
};

/**
 * Convert ControllerResult to HttpResponse
 */
export function toHttpResponse<T>(
  result: ControllerResult<T>,
  successStatus: number = 200
): HttpResponse {
  if (result.success) {
    return {
      statusCode: successStatus,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
      body: JSON.stringify(result.data),
    };
  }
  return {
    statusCode: result.status,
    headers: {
      "Content-Type": "application/json",
      ...CORS_HEADERS,
    },
    body: JSON.stringify({
      error: result.error,
      details: result.details,
    }),
  };
}

/**
 * Convert ControllerResult to Bun Response (for server.ts)
 */
export function toBunResponse<T>(
  result: ControllerResult<T>,
  successStatus: number = 200
): Response {
  if (result.success) {
    return new Response(JSON.stringify(result.data, null, 2), {
      status: successStatus,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    });
  }
  return new Response(
    JSON.stringify({
      error: result.error,
      details: result.details,
    }),
    {
      status: result.status,
      headers: {
        "Content-Type": "application/json",
        ...CORS_HEADERS,
      },
    }
  );
}

/**
 * Server.ts AuthContext (simpler than router.ts)
 */
export interface ServerAuthContext {
  userId: string;
  scope: string;
  canRead: boolean;
  canWrite: boolean;
  canIssueTicket: boolean;
  tokenId: string;
  allowedKey?: string;
}

/**
 * Convert server.ts AuthContext to controller AuthContext
 */
export function toControllerAuthFromServer(auth: ServerAuthContext): ControllerAuthContext {
  return {
    userId: auth.userId,
    realm: auth.scope, // server.ts uses 'scope' for realm
    tokenId: auth.tokenId,
    canRead: auth.canRead,
    canWrite: auth.canWrite,
    canIssueTicket: auth.canIssueTicket,
    canManageUsers: false, // server.ts doesn't have this concept
    allowedKeys: auth.allowedKey ? [auth.allowedKey] : undefined,
  };
}
