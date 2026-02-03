/**
 * Common schema definitions and ID format patterns
 *
 * All 128-bit identifiers use Crockford Base32 encoding (26 characters).
 */

import { z } from "zod";

// ============================================================================
// ID Format Patterns
// ============================================================================

/**
 * User ID format: user:{base32(uuid)}
 * Example: user:A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const USER_ID_REGEX = /^user:[A-Z0-9]{26}$/;

/**
 * Ticket ID format: ticket:{ulid}
 * Example: ticket:01HQXK5V8N3Y7M2P4R6T9W0ABC
 */
export const TICKET_ID_REGEX = /^ticket:[A-Z0-9]{26}$/;

/**
 * Depot ID format: depot:{ulid}
 * Example: depot:01HQXK5V8N3Y7M2P4R6T9W0ABC
 */
export const DEPOT_ID_REGEX = /^depot:[A-Z0-9]{26}$/;

/**
 * Client ID format: client:{blake3s(pubkey)}
 * Example: client:A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const CLIENT_ID_REGEX = /^client:[A-Z0-9]{26}$/;

/**
 * Token ID format: token:{blake3s(token)}
 * Example: token:A6JCHNMFWRT90AXMYWHJ8HKS90
 */
export const TOKEN_ID_REGEX = /^token:[A-Z0-9]{26}$/;

/**
 * Node key format: node:{blake3(content)}
 * Uses lowercase hex, 64 characters (256-bit hash)
 * Example: node:abc123def456...
 */
export const NODE_KEY_REGEX = /^node:[a-f0-9]{64}$/;

/**
 * Issuer ID format: can be client:{hash}, user:{id}, or token:{hash}
 */
export const ISSUER_ID_REGEX = /^(client|user|token):[A-Z0-9]{26}$/;

// ============================================================================
// Zod Schemas for IDs
// ============================================================================

export const UserIdSchema = z.string().regex(USER_ID_REGEX, "Invalid user ID format");
export const TicketIdSchema = z.string().regex(TICKET_ID_REGEX, "Invalid ticket ID format");
export const DepotIdSchema = z.string().regex(DEPOT_ID_REGEX, "Invalid depot ID format");
export const ClientIdSchema = z.string().regex(CLIENT_ID_REGEX, "Invalid client ID format");
export const TokenIdSchema = z.string().regex(TOKEN_ID_REGEX, "Invalid token ID format");
export const NodeKeySchema = z.string().regex(NODE_KEY_REGEX, "Invalid node key format");
export const IssuerIdSchema = z.string().regex(ISSUER_ID_REGEX, "Invalid issuer ID format");

// ============================================================================
// User Role
// ============================================================================

/**
 * User roles in the system
 * - unauthorized: Cannot access CAS resources
 * - authorized: Can access own Realm
 * - admin: Can manage all users
 */
export const UserRoleSchema = z.enum(["unauthorized", "authorized", "admin"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

// ============================================================================
// Ticket Status
// ============================================================================

/**
 * Ticket status derived from output and isRevoked fields:
 * - issued: output=null, isRevoked=false (active)
 * - committed: output=exists, isRevoked=false (completed)
 * - revoked: output=null, isRevoked=true (abandoned)
 * - archived: output=exists, isRevoked=true (completed then revoked)
 */
export const TicketStatusSchema = z.enum(["issued", "committed", "revoked", "archived"]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

// ============================================================================
// Node Kind
// ============================================================================

/**
 * Node types in CAS:
 * - dict: Directory node with child mappings
 * - file: File top-level node with content-type
 * - successor: File continuation node for large files
 */
export const NodeKindSchema = z.enum(["dict", "file", "successor"]);
export type NodeKind = z.infer<typeof NodeKindSchema>;

// ============================================================================
// Pagination
// ============================================================================

export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).optional().default(100),
  cursor: z.string().optional(),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
