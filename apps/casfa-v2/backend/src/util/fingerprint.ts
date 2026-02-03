/**
 * Identity fingerprint utilities
 *
 * Generates a unique fingerprint for each identity type using xxhash64.
 * Used for logging, auditing, and permission verification.
 *
 * Fingerprint formats:
 * - User: base64(xxh64('user:${userId}'))
 * - Agent Token: base64(xxh64('token:${tokenId}'))
 * - AWP Client: base64(xxh64('pubkey:${pubkey}'))
 * - Ticket: base64(xxh64('ticket:${ticketId}'))
 */

import xxhash from "xxhash-wasm";

let hasherPromise: ReturnType<typeof xxhash> | null = null;

const getHasher = async () => {
  if (!hasherPromise) {
    hasherPromise = xxhash();
  }
  return hasherPromise;
};

/**
 * Convert BigInt to URL-safe base64
 */
const base64FromBigInt = (value: bigint): string => {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[7 - i] = Number((value >> BigInt(i * 8)) & BigInt(0xff));
  }
  // Use URL-safe base64 (no padding)
  const base64 = btoa(String.fromCharCode(...bytes));
  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

/**
 * Generate fingerprint from user ID
 */
export const fingerprintFromUser = async (userId: string): Promise<string> => {
  const hasher = await getHasher();
  const hash = hasher.h64(`user:${userId}`);
  return base64FromBigInt(hash);
};

/**
 * Generate fingerprint from agent token ID
 */
export const fingerprintFromToken = async (tokenId: string): Promise<string> => {
  const hasher = await getHasher();
  const hash = hasher.h64(`token:${tokenId}`);
  return base64FromBigInt(hash);
};

/**
 * Generate fingerprint from AWP Client pubkey
 */
export const fingerprintFromPubkey = async (pubkey: string): Promise<string> => {
  const hasher = await getHasher();
  const hash = hasher.h64(`pubkey:${pubkey}`);
  return base64FromBigInt(hash);
};

/**
 * Generate fingerprint from ticket ID
 */
export const fingerprintFromTicket = async (ticketId: string): Promise<string> => {
  const hasher = await getHasher();
  const hash = hasher.h64(`ticket:${ticketId}`);
  return base64FromBigInt(hash);
};

/**
 * Identity type for fingerprint categorization
 */
export type IdentityType = "user" | "agent" | "awp" | "ticket";

/**
 * Generate fingerprint with identity type prefix for logging
 * Format: "{type}:{fingerprint}" e.g. "user:abc123def456"
 */
export const fingerprintWithType = async (type: IdentityType, id: string): Promise<string> => {
  let fp: string;
  switch (type) {
    case "user":
      fp = await fingerprintFromUser(id);
      break;
    case "agent":
      fp = await fingerprintFromToken(id);
      break;
    case "awp":
      fp = await fingerprintFromPubkey(id);
      break;
    case "ticket":
      fp = await fingerprintFromTicket(id);
      break;
  }
  return `${type}:${fp}`;
};
