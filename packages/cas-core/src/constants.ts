/**
 * CAS Binary Format Constants (v2)
 *
 * Node types:
 * - d-node (dict node): directory with sorted children by name
 * - s-node (successor node): file continuation chunk
 * - f-node (file node): file top-level node with content-type
 */

/**
 * Magic number: "CAS\x01" in little-endian (0x01534143)
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
 * Node type values (flags bits 0-1)
 *
 * Bit interpretation:
 * - Bit 0: has string section (names for d-node, content-type for f-node)
 * - Bit 1: has data section (s-node and f-node)
 *
 * | Type   | Bits | HasStrings | HasData |
 * |--------|------|------------|---------|
 * | d-node | 01   | yes(names) | no      |
 * | s-node | 10   | no         | yes     |
 * | f-node | 11   | yes(type)  | yes     |
 */
export const NODE_TYPE = {
  /** Dict node (directory) - 01b */
  DICT: 0b01,
  /** Successor node (file chunk) - 10b */
  SUCCESSOR: 0b10,
  /** File node (top-level file) - 11b */
  FILE: 0b11,
} as const;

/**
 * Content-type length encoding (flags bits 2-3, only for f-node)
 *
 * | Value | Bits | Length |
 * |-------|------|--------|
 * | 0     | 00   | 0      |
 * | 1     | 01   | 16     |
 * | 2     | 10   | 32     |
 * | 3     | 11   | 64     |
 */
export const CONTENT_TYPE_LENGTH = {
  NONE: 0,   // 0 bytes
  SHORT: 16, // 16 bytes
  MEDIUM: 32, // 32 bytes
  LONG: 64,  // 64 bytes
} as const;

/**
 * Content-type length values for encoding
 */
export const CONTENT_TYPE_LENGTH_VALUES = [0, 16, 32, 64] as const;

/**
 * Flag bit masks
 */
export const FLAGS = {
  /** Node type mask (bits 0-1) */
  TYPE_MASK: 0b11,
  /** Content-type length mask (bits 2-3) */
  CT_LENGTH_MASK: 0b1100,
  /** Content-type length shift */
  CT_LENGTH_SHIFT: 2,
  /** Used bits mask (bits 0-3), all other bits must be 0 */
  USED_MASK: 0b1111,
} as const;

/**
 * Alignment for data section (16 bytes)
 */
export const DATA_ALIGNMENT = 16;

/**
 * Default node limit (1 MB)
 */
export const DEFAULT_NODE_LIMIT = 1024 * 1024;

/**
 * Maximum safe integer for size field (2^53 - 1)
 * This is the JavaScript Number.MAX_SAFE_INTEGER
 */
export const MAX_SAFE_SIZE = Number.MAX_SAFE_INTEGER;
