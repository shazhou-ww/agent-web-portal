/**
 * Hash Provider - Default implementation using @noble/hashes
 *
 * Uses BLAKE3 truncated to 128 bits (16 bytes) for CAS node hashing.
 */

import type { HashProvider } from "@agent-web-portal/cas-core";
import { blake3 } from "@noble/hashes/blake3";

/**
 * Create a BLAKE3-based hash provider (128-bit output)
 *
 * This is the default hash provider for CASFA client.
 * Uses BLAKE3 truncated to 16 bytes to match CAS format.
 */
export const createBlake3HashProvider = (): HashProvider => ({
  hash: async (data: Uint8Array): Promise<Uint8Array> => {
    // BLAKE3 with 16 bytes (128 bits) output
    return blake3(data, { dkLen: 16 });
  },
});
