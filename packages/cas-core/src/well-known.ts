/**
 * Well-known CAS keys and data
 *
 * These are special CAS nodes with pre-computed hashes that have
 * system-wide significance.
 */

import { FLAGS, HEADER_SIZE, MAGIC } from "./constants.ts";

/**
 * Empty collection bytes - a collection with zero children
 *
 * Structure (32 bytes):
 * - magic: 0x01534143 (4 bytes, little-endian)
 * - flags: HAS_NAMES (4 bytes)
 * - count: 0 (4 bytes)
 * - size: 0 (8 bytes)
 * - namesOffset: 32 (4 bytes, points to end of header)
 * - typeOffset: 0 (4 bytes, unused)
 * - dataOffset: 0 (4 bytes, unused)
 */
export const EMPTY_COLLECTION_BYTES = new Uint8Array(HEADER_SIZE);

// Encode the empty collection header
(() => {
  const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
  view.setUint32(0, MAGIC, true); // magic
  view.setUint32(4, FLAGS.HAS_NAMES, true); // flags
  view.setUint32(8, 0, true); // count = 0
  view.setBigUint64(16, 0n, true); // size = 0
  view.setUint32(24, HEADER_SIZE, true); // namesOffset = 32
  view.setUint32(28, 0, true); // typeOffset = 0 (unused)
  // Note: dataOffset would be at offset 28 if we had 36-byte header,
  // but for 32-byte header, typeOffset and dataOffset share space
})();

/**
 * SHA-256 hash of EMPTY_COLLECTION_BYTES
 *
 * Computed from: sha256(32-byte header with count=0, size=0)
 */
export const EMPTY_COLLECTION_KEY =
  "sha256:a78577c5cfc47ab3e4b116f01902a69e2e015b40cdef52f9b552cfb5104e769a";

/**
 * Well-known keys for system-level CAS nodes
 */
export const WELL_KNOWN_KEYS = {
  /** Empty collection - used as initial root for new Depots */
  EMPTY_COLLECTION: EMPTY_COLLECTION_KEY,
} as const;
