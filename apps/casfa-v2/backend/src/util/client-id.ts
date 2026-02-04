/**
 * Client ID utilities
 *
 * Computes client ID from public key using Blake3s-128 hash
 * with Crockford Base32 encoding.
 *
 * Format: client:{26 characters Crockford Base32}
 */

import { blake3 } from "@noble/hashes/blake3";

// Crockford Base32 alphabet (excludes I, L, O, U to avoid ambiguity)
const CROCKFORD_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Encode bytes to Crockford Base32
 */
const toCrockfordBase32 = (bytes: Uint8Array): string => {
  let bits = 0;
  let value = 0;
  let result = "";

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      bits -= 5;
      result += CROCKFORD_ALPHABET[(value >> bits) & 0x1f];
    }
  }

  // Handle remaining bits
  if (bits > 0) {
    result += CROCKFORD_ALPHABET[(value << (5 - bits)) & 0x1f];
  }

  return result;
};

/**
 * Compute Blake3s-128 hash and encode to Crockford Base32
 *
 * @param data - Input string to hash
 * @returns 26-character Crockford Base32 encoded hash
 */
export const blake3sBase32 = (data: string): string => {
  const hash = blake3(data, { dkLen: 16 }); // 128 bits = 16 bytes
  return toCrockfordBase32(hash);
};

/**
 * Compute client ID from public key
 *
 * @param pubkey - Public key string (hex or base64 encoded)
 * @returns Client ID in format "client:{26 char Base32}"
 */
export const computeClientId = (pubkey: string): string => {
  return `client:${blake3sBase32(pubkey)}`;
};

/**
 * Compute token ID from token value
 *
 * @param tokenValue - Token value (casfa_xxx format)
 * @returns Token ID in format "token:{26 char Base32}"
 */
export const computeTokenId = (tokenValue: string): string => {
  return `token:${blake3sBase32(tokenValue)}`;
};

/**
 * Extract the hash part from a prefixed ID
 *
 * @param id - ID in format "{prefix}:{hash}"
 * @returns The hash part without prefix
 */
export const extractIdHash = (id: string): string => {
  const colonIndex = id.indexOf(":");
  if (colonIndex === -1) {
    throw new Error(`Invalid ID format: ${id}`);
  }
  return id.slice(colonIndex + 1);
};

/**
 * Validate client ID format
 *
 * @param clientId - Client ID to validate
 * @returns true if valid format
 */
export const isValidClientId = (clientId: string): boolean => {
  return /^client:[A-Z0-9]{26}$/.test(clientId);
};

/**
 * Validate token ID format
 *
 * @param tokenId - Token ID to validate
 * @returns true if valid format
 */
export const isValidTokenId = (tokenId: string): boolean => {
  return /^token:[A-Z0-9]{26}$/.test(tokenId);
};
