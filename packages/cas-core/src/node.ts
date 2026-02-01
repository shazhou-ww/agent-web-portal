/**
 * CAS Node Encoding/Decoding
 *
 * Node structure:
 * - HEADER (32 bytes)
 * - CHILDREN (N × 32 bytes) - raw hashes
 * - NAMES (Pascal strings) - collection only
 * - CONTENT-TYPE (Pascal string) - optional
 * - DATA (raw bytes) - chunk only
 */

import { FLAGS, HASH_SIZE, HEADER_SIZE } from "./constants.ts";
import { createChunkHeader, createCollectionHeader, decodeHeader, encodeHeader } from "./header.ts";
import type { CasNode, ChunkInput, CollectionInput, EncodedNode, HashProvider } from "./types.ts";
import { concatBytes, decodePascalString, decodePascalStrings, encodePascalString, encodePascalStrings } from "./utils.ts";

/**
 * Encode a chunk node (file data with optional children for B-Tree)
 */
export async function encodeChunk(
  input: ChunkInput,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, contentType, children = [] } = input;

  // Calculate sizes for each section
  const childrenSize = children.length * HASH_SIZE;
  const typeBytes = contentType ? encodePascalString(contentType) : new Uint8Array(0);
  const typeOffset = contentType ? HEADER_SIZE + childrenSize : 0;
  const dataOffset = HEADER_SIZE + childrenSize + typeBytes.length;

  // Compute logical size (this node's data + all children's sizes)
  // For now, just use this node's data size - caller should set properly for B-Tree
  const size = data.length;

  // Create header
  const header = createChunkHeader(size, children.length, typeOffset, dataOffset);
  const headerBytes = encodeHeader(header);

  // Flatten children hashes
  const childrenBytes = concatBytes(...children);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, typeBytes, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a chunk node with explicit size (for B-Tree internal nodes)
 */
export async function encodeChunkWithSize(
  input: ChunkInput,
  logicalSize: number,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { data, contentType, children = [] } = input;

  // Calculate sizes for each section
  const childrenSize = children.length * HASH_SIZE;
  const typeBytes = contentType ? encodePascalString(contentType) : new Uint8Array(0);
  const typeOffset = contentType ? HEADER_SIZE + childrenSize : 0;
  const dataOffset = HEADER_SIZE + childrenSize + typeBytes.length;

  // Create header with explicit size
  const header = createChunkHeader(logicalSize, children.length, typeOffset, dataOffset);
  const headerBytes = encodeHeader(header);

  // Flatten children hashes
  const childrenBytes = concatBytes(...children);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, typeBytes, data);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Encode a collection node (directory)
 */
export async function encodeCollection(
  input: CollectionInput,
  hashProvider: HashProvider
): Promise<EncodedNode> {
  const { size, contentType, children, childNames } = input;

  if (children.length !== childNames.length) {
    throw new Error(`Children count mismatch: ${children.length} hashes vs ${childNames.length} names`);
  }

  // Calculate sizes for each section
  const childrenSize = children.length * HASH_SIZE;
  const namesBytes = encodePascalStrings(childNames);
  const namesOffset = HEADER_SIZE + childrenSize;
  const typeBytes = contentType ? encodePascalString(contentType) : new Uint8Array(0);
  const typeOffset = contentType ? namesOffset + namesBytes.length : 0;

  // Create header
  const header = createCollectionHeader(size, children.length, namesOffset, typeOffset);
  const headerBytes = encodeHeader(header);

  // Flatten children hashes
  const childrenBytes = concatBytes(...children);

  // Combine all sections
  const nodeBytes = concatBytes(headerBytes, childrenBytes, namesBytes, typeBytes);

  // Compute hash
  const hash = await hashProvider.sha256(nodeBytes);

  return { bytes: nodeBytes, hash };
}

/**
 * Decode a CAS node from bytes
 */
export function decodeNode(buffer: Uint8Array): CasNode {
  const header = decodeHeader(buffer);

  const isCollection = (header.flags & FLAGS.HAS_NAMES) !== 0;
  const hasType = (header.flags & FLAGS.HAS_TYPE) !== 0;
  const hasData = (header.flags & FLAGS.HAS_DATA) !== 0;

  // Parse children
  const children: Uint8Array[] = [];
  let offset = HEADER_SIZE;
  for (let i = 0; i < header.count; i++) {
    children.push(buffer.slice(offset, offset + HASH_SIZE));
    offset += HASH_SIZE;
  }

  // Parse based on node type
  if (isCollection) {
    // Collection: parse names
    const childNames = decodePascalStrings(buffer, header.namesOffset, header.count);

    // Parse content type if present
    let contentType: string | undefined;
    if (hasType && header.typeOffset > 0) {
      [contentType] = decodePascalString(buffer, header.typeOffset);
    }

    return {
      kind: "collection",
      size: header.size,
      contentType,
      children: children.length > 0 ? children : undefined,
      childNames,
    };
  } else {
    // Chunk: parse content type and data
    let contentType: string | undefined;
    if (hasType && header.typeOffset > 0) {
      [contentType] = decodePascalString(buffer, header.typeOffset);
    }

    let data: Uint8Array | undefined;
    if (hasData && header.dataOffset > 0) {
      data = buffer.slice(header.dataOffset);
    }

    return {
      kind: "chunk",
      size: header.size,
      contentType,
      children: children.length > 0 ? children : undefined,
      data,
    };
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
export function getNodeKind(buffer: Uint8Array): "chunk" | "collection" | null {
  if (buffer.length < HEADER_SIZE) {
    return null;
  }

  try {
    const header = decodeHeader(buffer);
    return (header.flags & FLAGS.HAS_NAMES) !== 0 ? "collection" : "chunk";
  } catch {
    return null;
  }
}
