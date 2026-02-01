/**
 * CAS Node Header Encoding/Decoding
 *
 * Header layout (32 bytes):
 * - magic:       4 bytes (u32 LE) - 0x01534143 ("CAS\x01")
 * - flags:       4 bytes (u32 LE) - bit flags
 * - count:       4 bytes (u32 LE) - number of children
 * - size:        8 bytes (u64 LE) - logical size (stored as two u32s for JS compat)
 * - namesOffset: 4 bytes (u32 LE) - offset to NAMES section
 * - typeOffset:  4 bytes (u32 LE) - offset to CONTENT-TYPE section
 * - dataOffset:  4 bytes (u32 LE) - offset to DATA section
 */

import { FLAGS, HEADER_SIZE, MAGIC } from "./constants.ts";
import type { CasHeader } from "./types.ts";

/**
 * Encode a CAS header to bytes
 */
export function encodeHeader(header: CasHeader): Uint8Array {
  const buffer = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(buffer);

  view.setUint32(0, header.magic, true); // LE
  view.setUint32(4, header.flags, true);
  view.setUint32(8, header.count, true);

  // Size as u64 LE (split into low and high u32)
  // For sizes up to 2^53-1, high bits will be small
  const sizeLow = header.size >>> 0; // Low 32 bits
  const sizeHigh = Math.floor(header.size / 0x100000000) >>> 0; // High 32 bits
  view.setUint32(12, sizeLow, true);
  view.setUint32(16, sizeHigh, true);

  view.setUint32(20, header.namesOffset, true);
  view.setUint32(24, header.typeOffset, true);
  view.setUint32(28, header.dataOffset, true);

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
  const count = view.getUint32(8, true);

  // Size as u64 LE
  const sizeLow = view.getUint32(12, true);
  const sizeHigh = view.getUint32(16, true);
  const size = sizeLow + sizeHigh * 0x100000000;

  const namesOffset = view.getUint32(20, true);
  const typeOffset = view.getUint32(24, true);
  const dataOffset = view.getUint32(28, true);

  return {
    magic,
    flags,
    count,
    size,
    namesOffset,
    typeOffset,
    dataOffset,
  };
}

/**
 * Create a header for a chunk node
 */
export function createChunkHeader(
  size: number,
  childCount: number,
  typeOffset: number,
  dataOffset: number
): CasHeader {
  let flags = FLAGS.HAS_DATA;
  if (typeOffset > 0) {
    flags |= FLAGS.HAS_TYPE;
  }

  return {
    magic: MAGIC,
    flags,
    count: childCount,
    size,
    namesOffset: 0,
    typeOffset,
    dataOffset,
  };
}

/**
 * Create a header for a collection node
 */
export function createCollectionHeader(
  size: number,
  childCount: number,
  namesOffset: number,
  typeOffset: number
): CasHeader {
  let flags = FLAGS.HAS_NAMES;
  if (typeOffset > 0) {
    flags |= FLAGS.HAS_TYPE;
  }

  return {
    magic: MAGIC,
    flags,
    count: childCount,
    size,
    namesOffset,
    typeOffset,
    dataOffset: 0,
  };
}
