/**
 * CAS Node Encoding/Decoding (v2)
 *
 * Node types:
 * - d-node (dict): Header + Children + Names (Pascal strings)
 * - s-node (successor): Header + Children + Data (16-byte aligned)
 * - f-node (file): Header + Children + ContentType (padded to 0/16/32/64) + Data (16-byte aligned)
 *
 * All reserved/padding bytes MUST be 0 for hash stability.
 */

import { CONTENT_TYPE_LENGTH_VALUES, DATA_ALIGNMENT, FLAGS, HASH_SIZE, HEADER_SIZE, NODE_TYPE } from "./constants.ts";
import {
  createDictHeader,
  createFileHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getContentTypeLength,
  getNodeType,
} from "./header.ts";
import type { CasNode, DictNodeInput, EncodedNode, FileNodeInput, HashProvider, NodeKind, SuccessorNodeInput } from "./types.ts";
import { concatBytes, decodePascalStrings, encodePascalStrings } from "./utils.ts";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

/**
 * Calculate the content-type slot size (0, 16, 32, or 64)
 */
function getContentTypeSlotSize(contentType: string | undefined): 0 | 16 | 32 | 64 {
  if (!contentType) return 0;
  const bytes = textEncoder.encode(contentType);
  if (bytes.length <= 16) return 16;
  if (bytes.length <= 32) return 32;
  if (bytes.length <= 64) return 64;
  throw new Error(`Content-type too long: ${bytes.length} bytes (max 64)`);
}

/**
 * Encode content-type with zero padding to slot size
 */
function encodeContentType(contentType: string, slotSize: 16 | 32 | 64): Uint8Array {
  const bytes = textEncoder.encode(contentType);
  if (bytes.length > slotSize) {
    throw new Error(`Content-type too long: ${bytes.length} > ${slotSize}`);
  }
  const result = new Uint8Array(slotSize); // Initialized to 0
  result.set(bytes, 0);
  return result;
}

/**
 * Decode content-type from padded slot (null-terminated or full slot)
 */
function decodeContentType(buffer: Uint8Array, offset: number, slotSize: number): string {
  const slice = buffer.subarray(offset, offset + slotSize);
  // Find null terminator or use full length
  let end = slice.indexOf(0);
  if (end === -1) end = slotSize;
  return textDecoder.decode(slice.subarray(0, end));
}

/**
 * Sort children by name (UTF-8 byte order) for d-node
 * Returns sorted [names, children] arrays
 */
function sortChildrenByName(
  names: string[],
  children: Uint8Array[]
): { sortedNames: string[]; sortedChildren: Uint8Array[] } {
  const pairs = names.map((name, i) => ({ name, child: children[i]! }));
  pairs.sort((a, b) => {
    const aBuf = textEncoder.encode(a.name);
    const bBuf = textEncoder.encode(b.name);
    const minLen = Math.min(aBuf.length, bBuf.length);
    for (let i = 0; i < minLen; i++) {
      if (aBuf[i]! !== bBuf[i]!) return aBuf[i]! - bBuf[i]!;
    }
    return aBuf.length - bBuf.length;
  });
  return {
    sortedNames: pairs.map((p) => p.name),
    sortedChildren: pairs.map((p) => p.child),
  };
}

/**
 * Encode a dict node (d-node) - directory with sorted children
 */
export async function encodeDictNode(
  input: DictNodeInput,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { size, children, childNames } = input;

  if (children.length !== childNames.length) {
    throw new Error(`Children count mismatch: ${children.length} hashes vs ${childNames.length} names`);
  }

  // Sort children by name (UTF-8 byte order)
  const { sortedNames, sortedChildren } = sortChildrenByName(childNames, children);

  // Encode sections
  const childrenBytes = concatBytes(...sortedChildren);
  const namesBytes = encodePascalStrings(sortedNames);

  // Calculate total length
  const totalLength = HEADER_SIZE + childrenBytes.length + namesBytes.length;

  // Create header
  const header = createDictHeader(size, children.length, totalLength);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, namesBytes);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a successor node (s-node) - file continuation chunk
 */
export async function encodeSuccessorNode(
  input: SuccessorNodeInput,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, children = [] } = input;

  // Encode sections
  const childrenBytes = concatBytes(...children);

  // Calculate data offset with 16-byte alignment
  const dataOffsetUnaligned = HEADER_SIZE + childrenBytes.length;
  const dataOffset = Math.ceil(dataOffsetUnaligned / DATA_ALIGNMENT) * DATA_ALIGNMENT;
  const paddingSize = dataOffset - dataOffsetUnaligned;

  // Calculate total length
  const totalLength = dataOffset + data.length;

  // Create header
  const header = createSuccessorHeader(data.length, children.length, totalLength);
  const headerBytes = encodeHeader(header);

  // Create padding (zeros)
  const padding = new Uint8Array(paddingSize);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, padding, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a successor node with explicit logical size (for B-Tree internal nodes)
 */
export async function encodeSuccessorNodeWithSize(
  input: SuccessorNodeInput,
  logicalSize: number,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, children = [] } = input;

  // Encode sections
  const childrenBytes = concatBytes(...children);

  // Calculate data offset with 16-byte alignment
  const dataOffsetUnaligned = HEADER_SIZE + childrenBytes.length;
  const dataOffset = Math.ceil(dataOffsetUnaligned / DATA_ALIGNMENT) * DATA_ALIGNMENT;
  const paddingSize = dataOffset - dataOffsetUnaligned;

  // Calculate total length
  const totalLength = dataOffset + data.length;

  // Create header with explicit size
  const header = createSuccessorHeader(logicalSize, children.length, totalLength);
  const headerBytes = encodeHeader(header);

  // Create padding (zeros)
  const padding = new Uint8Array(paddingSize);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, padding, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a file node (f-node) - top-level file with content-type
 */
export async function encodeFileNode(
  input: FileNodeInput,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, contentType, children = [] } = input;

  // Determine content-type slot size
  const ctSlotSize = getContentTypeSlotSize(contentType);

  // Encode sections
  const childrenBytes = concatBytes(...children);
  const ctBytes = ctSlotSize > 0 ? encodeContentType(contentType!, ctSlotSize as 16 | 32 | 64) : new Uint8Array(0);

  // Calculate data offset - already 16-byte aligned because:
  // Header(32) + Children(N*32) + CT(0/16/32/64) are all multiples of 16
  const dataOffset = HEADER_SIZE + childrenBytes.length + ctBytes.length;

  // Calculate total length
  const totalLength = dataOffset + data.length;

  // Create header
  const header = createFileHeader(data.length, children.length, totalLength, ctSlotSize);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, ctBytes, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a file node with explicit logical size (for B-Tree internal nodes)
 */
export async function encodeFileNodeWithSize(
  input: FileNodeInput,
  logicalSize: number,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, contentType, children = [] } = input;

  // Determine content-type slot size
  const ctSlotSize = getContentTypeSlotSize(contentType);

  // Encode sections
  const childrenBytes = concatBytes(...children);
  const ctBytes = ctSlotSize > 0 ? encodeContentType(contentType!, ctSlotSize as 16 | 32 | 64) : new Uint8Array(0);

  // Calculate data offset
  const dataOffset = HEADER_SIZE + childrenBytes.length + ctBytes.length;

  // Calculate total length
  const totalLength = dataOffset + data.length;

  // Create header with explicit size
  const header = createFileHeader(logicalSize, children.length, totalLength, ctSlotSize);
  const headerBytes = encodeHeader(header);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, ctBytes, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Decode a CAS node from bytes
 */
export function decodeNode(buffer: Uint8Array): CasNode {
  const header = decodeHeader(buffer);
  const nodeType = getNodeType(header.flags);

  // Parse children
  const children: Uint8Array[] = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < header.count; i++) {
    children.push(buffer.slice(offset, offset + HASH_SIZE));
    offset += HASH_SIZE;
  }

  // Parse based on node type
  switch (nodeType) {
    case NODE_TYPE.DICT: {
      // d-node: parse names
      const childNames = decodePascalStrings(buffer, offset, header.count);
      return {
        kind: "dict",
        size: header.size,
        children: children.length > 0 ? children : undefined,
        childNames,
      };
    }

    case NODE_TYPE.SUCCESSOR: {
      // s-node: parse data (16-byte aligned)
      const dataOffset = Math.ceil(offset / DATA_ALIGNMENT) * DATA_ALIGNMENT;
      const data = buffer.slice(dataOffset);
      return {
        kind: "successor",
        size: header.size,
        children: children.length > 0 ? children : undefined,
        data,
      };
    }

    case NODE_TYPE.FILE: {
      // f-node: parse content-type and data
      const ctLength = getContentTypeLength(header.flags);
      let contentType: string | undefined;
      if (ctLength > 0) {
        contentType = decodeContentType(buffer, offset, ctLength);
        offset += ctLength;
      }
      const data = buffer.slice(offset);
      return {
        kind: "file",
        size: header.size,
        contentType,
        children: children.length > 0 ? children : undefined,
        data,
      };
    }

    default:
      throw new Error(`Unknown node type: ${nodeType}`);
  }
}

/**
 * Check if a buffer is a valid CAS node (has correct magic)
 */
export function isValidNode(buffer: Uint8Array): boolean {
  if (buffer.length < HEADER_SIZE) {
    return false;
  }

  try {
    decodeHeader(buffer);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get node kind from buffer without full decode
 */
export function getNodeKind(buffer: Uint8Array): NodeKind | null {
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  try {
    const header = decodeHeader(buffer);
    const nodeType = getNodeType(header.flags);
    switch (nodeType) {
      case NODE_TYPE.DICT:
        return "dict";
      case NODE_TYPE.SUCCESSOR:
        return "successor";
      case NODE_TYPE.FILE:
        return "file";
      default:
        return null;
    }
  } catch {
    return null;
  }
}

// Legacy aliases for backward compatibility during migration
export const encodeChunk = encodeFileNode;
export const encodeChunkWithSize = encodeFileNodeWithSize;
export const encodeCollection = encodeDictNode;
