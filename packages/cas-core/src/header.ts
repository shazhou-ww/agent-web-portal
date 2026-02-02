/**
 * CAS Node Header Encoding/Decoding (v2)
 *
 * Header layout (32 bytes):
 * - 0-3:   magic (u32 LE) - 0x01534143 ("CAS\x01")
 * - 4-7:   flags (u32 LE) - node type (bits 0-1), content-type length (bits 2-3)
 * - 8-15:  size (u64 LE) - logical size
 * - 16-19: count (u32 LE) - number of children
 * - 20-23: length (u32 LE) - total block length for validation
 * - 24-31: reserved (must be 0)
 */

import { CONTENT_TYPE_LENGTH_VALUES, FLAGS, HEADER_SIZE, MAGIC, NODE_TYPE } from "./constants.ts";
import type { CasHeader } from "./types.ts";

/**
 * Encode a CAS header to bytes
 */
export function encodeHeader(header: CasHeader): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, header.magic, true); // LE
  view.setUint32(4, header.flags, true);

  // Size as u64 LE (split into low and high u32)
  const sizeLow = header.size >>> 0;
  const sizeHigh = Math.floor(header.size / 0x100000000) >>> 0;
  view.setUint32(8, sizeLow, true);
  view.setUint32(12, sizeHigh, true);

  view.setUint32(16, header.count, true);
  view.setUint32(20, header.length, true);

  // Bytes 24-31 are reserved (already 0)

  return new Uint8Array(buffer);
}

/**
 * Decode a CAS header from bytes
 * @throws Error if magic number is invalid or buffer too small
 */
export function decodeHeader(buffer: Uint8Array): CasHeader {
  if (buffer.length < HEADER_SIZE) {
    throw new Error(`Buffer too small: ${buffer.length} < ${HEADER_SIZE}`);
  }

  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  const magic = view.getUint32(0, true);
  if (magic !== MAGIC) {
    throw new Error(`Invalid magic: 0x${magic.toString(16)} (expected 0x${MAGIC.toString(16)})`);
  }

  const flags = view.getUint32(4, true);

  // Size as u64 LE
  const sizeLow = view.getUint32(8, true);
  const sizeHigh = view.getUint32(12, true);
  const size = sizeLow + sizeHigh * 0x100000000;

  const count = view.getUint32(16, true);
  const length = view.getUint32(20, true);

  return {
    magic,
    flags,
    size,
    count,
    length,
  };
}

/**
 * Get node type from flags
 */
export function getNodeType(flags: number): number {
  return flags & FLAGS.TYPE_MASK;
}

/**
 * Get content-type length from flags (only valid for f-node)
 */
export function getContentTypeLength(flags: number): number {
  const index = (flags & FLAGS.CT_LENGTH_MASK) >> FLAGS.CT_LENGTH_SHIFT;
  return CONTENT_TYPE_LENGTH_VALUES[index] ?? 0;
}

/**
 * Build flags for a dict node (d-node)
 */
export function buildDictFlags(): number {
  return NODE_TYPE.DICT;
}

/**
 * Build flags for a successor node (s-node)
 */
export function buildSuccessorFlags(): number {
  return NODE_TYPE.SUCCESSOR;
}

/**
 * Build flags for a file node (f-node) with content-type length
 */
export function buildFileFlags(contentTypeLength: 0 | 16 | 32 | 64): number {
  const lengthIndex = CONTENT_TYPE_LENGTH_VALUES.indexOf(contentTypeLength);
  if (lengthIndex === -1) {
    throw new Error(`Invalid content-type length: ${contentTypeLength}`);
  }
  return NODE_TYPE.FILE | (lengthIndex << FLAGS.CT_LENGTH_SHIFT);
}

/**
 * Create a header for a dict node (d-node)
 */
export function createDictHeader(size: number, count: number, totalLength: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildDictFlags(),
    size,
    count,
    length: totalLength,
  };
}

/**
 * Create a header for a successor node (s-node)
 */
export function createSuccessorHeader(size: number, count: number, totalLength: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildSuccessorFlags(),
    size,
    count,
    length: totalLength,
  };
}

/**
 * Create a header for a file node (f-node)
 */
export function createFileHeader(
  size: number,
  count: number,
  totalLength: number,
  contentTypeLength: 0 | 16 | 32 | 64
): CasHeader {
  return {
    magic: MAGIC,
    flags: buildFileFlags(contentTypeLength),
    size,
    count,
    length: totalLength,
  };
}
