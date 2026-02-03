/**
 * CAS Node Header Encoding/Decoding (v2.1)
 *
 * Header layout (32 bytes):
 * - 0-3:   magic (u32 LE) - 0x01534143 ("CAS\x01")
 * - 4-7:   flags (u32 LE) - node type (bits 0-1), reserved (bits 2-31)
 * - 8-11:  size (u32 LE) - payload size
 * - 12-15: count (u32 LE) - number of children
 * - 16-31: reserved (16 bytes, must be 0)
 */

import { FLAGS, HEADER_SIZE, MAGIC, NODE_TYPE } from "./constants.ts";
import type { CasHeader } from "./types.ts";

/**
 * Encode a CAS header to bytes
 */
export function encodeHeader(header: CasHeader): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, header.magic, true); // LE
  view.setUint32(4, header.flags, true);
  view.setUint32(8, header.size, true);
  view.setUint32(12, header.count, true);
  // Bytes 16-31 are reserved (already 0)

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
  const size = view.getUint32(8, true);
  const count = view.getUint32(12, true);

  return {
    magic,
    flags,
    size,
    count,
  };
}

/**
 * Get node type from flags
 */
export function getNodeType(flags: number): number {
  return flags & FLAGS.TYPE_MASK;
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
 * Build flags for a file node (f-node)
 */
export function buildFileFlags(): number {
  return NODE_TYPE.FILE;
}

/**
 * Create a header for a dict node (d-node)
 * @param payloadSize - Size of names payload (sum of Pascal string lengths)
 * @param count - Number of children
 */
export function createDictHeader(payloadSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildDictFlags(),
    size: payloadSize,
    count,
  };
}

/**
 * Create a header for a successor node (s-node)
 * @param dataSize - Size of data payload
 * @param count - Number of children
 */
export function createSuccessorHeader(dataSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildSuccessorFlags(),
    size: dataSize,
    count,
  };
}

/**
 * Create a header for a file node (f-node)
 * @param payloadSize - Size of payload (FileInfo + data)
 * @param count - Number of children
 */
export function createFileHeader(payloadSize: number, count: number): CasHeader {
  return {
    magic: MAGIC,
    flags: buildFileFlags(),
    size: payloadSize,
    count,
  };
}
