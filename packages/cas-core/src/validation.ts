/**
 * CAS Node Validation (v2)
 *
 * Strict validation for server-side use:
 * - Magic and header structure
 * - Hash matches content
 * - All children exist
 * - Pascal strings are valid
 * - Size is correct for dict nodes
 */

import { FLAGS, HASH_SIZE, HEADER_SIZE, MAGIC_BYTES, NODE_TYPE } from "./constants.ts";
import { decodeHeader, getContentTypeLength, getNodeType } from "./header.ts";
import type { HashProvider, NodeKind } from "./types.ts";
import { hashToKey } from "./utils.ts";

/**
 * Validation result
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
  kind?: NodeKind;
  size?: number;
  childKeys?: string[];
}

/**
 * Function to check if a key exists
 */
export type ExistsChecker = (key: string) => Promise<boolean>;

/**
 * Validate a Pascal string at the given offset
 * Pascal string format: u16 LE length + UTF-8 bytes
 * Returns [isValid, bytesConsumed, error?]
 */
function validatePascalString(
  buffer: Uint8Array,
  offset: number
): [valid: boolean, bytesConsumed: number, error?: string] {
  // Need at least 2 bytes for length
  if (offset + 2 > buffer.length) {
    return [false, 0, `Pascal string at ${offset}: not enough bytes for length`];
  }

  // Read u16 LE length
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const length = view.getUint16(offset, true);

  // Check if string data fits in buffer
  if (offset + 2 + length > buffer.length) {
    return [false, 0, `Pascal string at ${offset} exceeds buffer (length=${length})`];
  }

  // Validate UTF-8 by attempting decode
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    decoder.decode(buffer.slice(offset + 2, offset + 2 + length));
    return [true, 2 + length];
  } catch {
    return [false, 0, `Invalid UTF-8 in Pascal string at ${offset}`];
  }
}

/**
 * Validate multiple Pascal strings starting at offset
 */
function validatePascalStrings(
  buffer: Uint8Array,
  offset: number,
  count: number
): [valid: boolean, error?: string] {
  let currentOffset = offset;

  for (let i = 0; i < count; i++) {
    const [valid, bytesConsumed, error] = validatePascalString(buffer, currentOffset);
    if (!valid) {
      return [false, `Name ${i}: ${error}`];
    }

    // Move to next string
    currentOffset += bytesConsumed;
  }

  return [true];
}

/**
 * Validate a CAS node strictly
 *
 * Checks:
 * 1. Magic bytes
 * 2. Header structure and offsets
 * 3. Hash matches expectedKey
 * 4. Pascal strings are valid (names, contentType)
 * 5. All children exist (if existsChecker provided)
 * 6. For collections: size equals sum of children sizes
 *
 * @param bytes - Raw node bytes
 * @param expectedKey - Expected hash key (sha256:...)
 * @param hashProvider - Hash provider for verification
 * @param existsChecker - Optional function to check child existence
 * @param getSize - Optional function to get child size for collection validation
 */
export async function validateNode(
  bytes: Uint8Array,
  expectedKey: string,
  hashProvider: HashProvider,
  existsChecker?: ExistsChecker,
  getSize?: (key: string) => Promise<number | null>
): Promise<ValidationResult> {
  // 1. Check minimum size
  if (bytes.length < HEADER_SIZE) {
    return { valid: false, error: "Buffer too small for header" };
  }

  // 2. Check magic
  if (
    bytes[0] !== MAGIC_BYTES[0] ||
    bytes[1] !== MAGIC_BYTES[1] ||
    bytes[2] !== MAGIC_BYTES[2] ||
    bytes[3] !== MAGIC_BYTES[3]
  ) {
    return { valid: false, error: "Invalid magic bytes" };
  }

  // 3. Parse header
  let header;
  try {
    header = decodeHeader(bytes);
  } catch (e: any) {
    return { valid: false, error: `Header decode failed: ${e.message}` };
  }

  const nodeType = getNodeType(header.flags);
  let kind: NodeKind;
  switch (nodeType) {
    case NODE_TYPE.DICT:
      kind = "dict";
      break;
    case NODE_TYPE.SUCCESSOR:
      kind = "successor";
      break;
    case NODE_TYPE.FILE:
      kind = "file";
      break;
    default:
      return { valid: false, error: `Unknown node type: ${nodeType}` };
  }

  const isDict = nodeType === NODE_TYPE.DICT;

  // 4. Validate children section is within bounds
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return {
      valid: false,
      error: `Children section exceeds buffer (need ${childrenEnd}, have ${bytes.length})`,
    };
  }

  // 5. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 6. Validate Pascal strings for d-node names
  if (isDict && header.count > 0) {
    // Names section starts right after children
    const namesOffset = childrenEnd;
    const [valid, error] = validatePascalStrings(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
  }

  // 7. Verify hash
  const actualHash = await hashProvider.sha256(bytes);
  const actualKey = hashToKey(actualHash);
  if (actualKey !== expectedKey) {
    return {
      valid: false,
      error: `Hash mismatch: expected ${expectedKey}, got ${actualKey}`,
    };
  }

  // 8. Check children exist (if checker provided)
  if (existsChecker && childKeys.length > 0) {
    const missing: string[] = [];
    for (const key of childKeys) {
      const exists = await existsChecker(key);
      if (!exists) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing children: ${missing.join(", ")}`,
        kind,
        size: header.size,
        childKeys,
      };
    }
  }

  // 9. Validate dict node size (sum of children sizes)
  if (isDict && getSize && childKeys.length > 0) {
    let expectedSize = 0;
    for (const key of childKeys) {
      const childSize = await getSize(key);
      if (childSize === null) {
        return {
          valid: false,
          error: `Cannot get size for child: ${key}`,
          kind,
          size: header.size,
          childKeys,
        };
      }
      expectedSize += childSize;
    }
    if (header.size !== expectedSize) {
      return {
        valid: false,
        error: `Dict size mismatch: header=${header.size}, computed=${expectedSize}`,
        kind,
        size: header.size,
        childKeys,
      };
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}

/**
 * Quick validation without async checks
 * Only validates structure, not hash or children
 */
export function validateNodeStructure(bytes: Uint8Array): ValidationResult {
  // 1. Check minimum size
  if (bytes.length < HEADER_SIZE) {
    return { valid: false, error: "Buffer too small for header" };
  }

  // 2. Check magic
  if (
    bytes[0] !== MAGIC_BYTES[0] ||
    bytes[1] !== MAGIC_BYTES[1] ||
    bytes[2] !== MAGIC_BYTES[2] ||
    bytes[3] !== MAGIC_BYTES[3]
  ) {
    return { valid: false, error: "Invalid magic bytes" };
  }

  // 3. Parse header
  let header;
  try {
    header = decodeHeader(bytes);
  } catch (e: any) {
    return { valid: false, error: `Header decode failed: ${e.message}` };
  }

  const nodeType = getNodeType(header.flags);
  let kind: NodeKind;
  switch (nodeType) {
    case NODE_TYPE.DICT:
      kind = "dict";
      break;
    case NODE_TYPE.SUCCESSOR:
      kind = "successor";
      break;
    case NODE_TYPE.FILE:
      kind = "file";
      break;
    default:
      return { valid: false, error: `Unknown node type: ${nodeType}` };
  }

  const isDict = nodeType === NODE_TYPE.DICT;

  // 4. Validate children section
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return { valid: false, error: "Children section exceeds buffer" };
  }

  // 5. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 6. Validate Pascal strings for d-node names
  if (isDict && header.count > 0) {
    const namesOffset = childrenEnd;
    const [valid, error] = validatePascalStrings(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}
