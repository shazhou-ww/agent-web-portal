/**
 * Well-known CAS keys and data
 *
 * These are special CAS nodes with pre-computed hashes that have
 * system-wide significance.
 */

import { HEADER_SIZE, MAGIC, NODE_TYPE } from "./constants.ts";

/**
 * Empty dict node bytes - a d-node with zero children
 *
 * Structure (32 bytes):
 * - 0-3:   magic: 0x01534143 (4 bytes, little-endian)
 * - 4-7:   flags: NODE_TYPE.DICT (0b01) (4 bytes)
 * - 8-15:  size: 0 (8 bytes)
 * - 16-19: count: 0 (4 bytes)
 * - 20-23: length: 32 (4 bytes, total block length)
 * - 24-31: reserved: 0 (8 bytes)
 *
 * All reserved/padding bytes are 0 for hash stability.
 */
export const EMPTY_DICT_BYTES = new Uint8Array(HEADER_SIZE);

// Encode the empty dict node header
(() => {
  const view = new DataView(EMPTY_DICT_BYTES.buffer);
  view.setUint32(0, MAGIC, true); // magic
  view.setUint32(4, NODE_TYPE.DICT, true); // flags = d-node (0b01)
  // 8-15: size = 0 (already 0)
  view.setUint32(16, 0, true); // count = 0
  view.setUint32(20, HEADER_SIZE, true); // length = 32
  // 24-31: reserved = 0 (already 0)
})();

/**
 * SHA-256 hash of EMPTY_DICT_BYTES
 *
 * Computed from: sha256(32-byte header with d-node flags, count=0, size=0, length=32)
 */
export const EMPTY_DICT_KEY =
  "sha256:04821167d026fa3b24e160b8f9f0ff2a342ca1f96c78c24b23e6a086b71e2391";

/**
 * Well-known keys for system-level CAS nodes
 */
export const WELL_KNOWN_KEYS = {
  /** Empty dict node - used as initial root for new Depots */
  EMPTY_DICT: EMPTY_DICT_KEY,
} as const;
