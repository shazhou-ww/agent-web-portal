/**
 * CAS Binary Format Constants
 */

/**
 * Magic number: "CAS\x01" in little-endian (0x01 0x53 0x41 0x43)
 * Read as u32 LE: 0x01534143
 */
export const MAGIC = 0x01534143;

/**
 * Magic bytes for validation
 */
export const MAGIC_BYTES = new Uint8Array([0x43, 0x41, 0x53, 0x01]); // "CAS\x01"

/**
 * Header size in bytes
 */
export const HEADER_SIZE = 32;

/**
 * SHA-256 hash size in bytes
 */
export const HASH_SIZE = 32;

/**
 * Flag bits for node header
 */
export const FLAGS = {
  /** Node has NAMES section (collection only) */
  HAS_NAMES: 1 << 0,
  /** Node has CONTENT-TYPE section */
  HAS_TYPE: 1 << 1,
  /** Node has DATA section (chunk only) */
  HAS_DATA: 1 << 2,
} as const;

/**
 * Default node limit (1 MB)
 */
export const DEFAULT_NODE_LIMIT = 1024 * 1024;

/**
 * Maximum safe integer for size field (2^53 - 1)
 * This is the JavaScript Number.MAX_SAFE_INTEGER
 */
export const MAX_SAFE_SIZE = Number.MAX_SAFE_INTEGER;
