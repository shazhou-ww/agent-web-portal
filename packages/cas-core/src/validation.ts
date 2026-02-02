/**
 * CAS Node Validation (v2)
 *
 * Strict validation for server-side use:
 * - Magic and header structure
 * - Header.length matches actual buffer length
 * - Reserved bytes are all zero
 * - Hash matches content
 * - All children exist
 * - Pascal strings are valid (names, contentType)
 * - Content-type and data sections are within bounds
 * - d-node children are sorted by name (UTF-8 byte order)
 * - Size is correct for dict nodes (sum of children sizes)
 */

import { DATA_ALIGNMENT, FLAGS, HASH_SIZE, HEADER_SIZE, MAGIC_BYTES, NODE_TYPE } from "./constants.ts";
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
 * Validate multiple Pascal strings and return the decoded names
 */
function validatePascalStringsWithNames(
  buffer: Uint8Array,
  offset: number,
  count: number
): [valid: boolean, error?: string, names?: string[]] {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const names: string[] = [];
  let currentOffset = offset;

  for (let i = 0; i < count; i++) {
    const [valid, bytesConsumed, error] = validatePascalString(buffer, currentOffset);
    if (!valid) {
      return [false, `Name ${i}: ${error}`];
    }

    // Decode the name
    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    const length = view.getUint16(currentOffset, true);
    try {
      const name = decoder.decode(buffer.slice(currentOffset + 2, currentOffset + 2 + length));
      names.push(name);
    } catch {
      return [false, `Name ${i}: Invalid UTF-8`];
    }

    // Move to next string
    currentOffset += bytesConsumed;
  }

  return [true, undefined, names];
}

/**
 * Compare two byte arrays lexicographically
 * Returns negative if a < b, 0 if equal, positive if a > b
 */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    if (a[i]! !== b[i]!) return a[i]! - b[i]!;
  }
  return a.length - b.length;
}

/**
 * Validate multiple Pascal strings starting at offset (no name extraction)
 */
function validatePascalStringsNoExtract(
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
  const isFile = nodeType === NODE_TYPE.FILE;
  const isSuccessor = nodeType === NODE_TYPE.SUCCESSOR;

  // 4. Validate header.length matches actual buffer length
  if (header.length !== bytes.length) {
    return {
      valid: false,
      error: `Length mismatch: header.length=${header.length}, actual=${bytes.length}`,
    };
  }

  // 5. Validate reserved bytes are zero (bytes 24-31)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reserved1 = view.getUint32(24, true);
  const reserved2 = view.getUint32(28, true);
  if (reserved1 !== 0 || reserved2 !== 0) {
    return {
      valid: false,
      error: `Reserved bytes not zero: [${reserved1}, ${reserved2}]`,
    };
  }

  // 6. Validate children section is within bounds
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return {
      valid: false,
      error: `Children section exceeds buffer (need ${childrenEnd}, have ${bytes.length})`,
    };
  }

  // 7. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 8. Validate CT_LENGTH field
  const ctLength = getContentTypeLength(header.flags);

  // 8a. For non-f-node (d-node, s-node), CT_LENGTH must be 0
  if (!isFile && ctLength !== 0) {
    return {
      valid: false,
      error: `Non-file node must have CT_LENGTH=0, got ${ctLength}`,
    };
  }

  // 8b. For f-node, validate content-type section and minimal slot requirement
  if (isFile && ctLength > 0) {
    const ctEnd = childrenEnd + ctLength;
    if (ctEnd > bytes.length) {
      return {
        valid: false,
        error: `Content-type section exceeds buffer (need ${ctEnd}, have ${bytes.length})`,
      };
    }

    // Read content-type slot
    const ctSlice = bytes.subarray(childrenEnd, ctEnd);

    // Find actual content-type length (first null or slot end)
    let actualCtLen = ctSlice.indexOf(0);
    if (actualCtLen === -1) actualCtLen = ctLength;

    // Check minimal slot requirement for hash uniqueness
    const minimalSlot = actualCtLen === 0 ? 0 : actualCtLen <= 16 ? 16 : actualCtLen <= 32 ? 32 : 64;
    if (ctLength !== minimalSlot) {
      return {
        valid: false,
        error: `Content-type slot over-allocated: length ${actualCtLen} requires slot ${minimalSlot}, got ${ctLength}`,
      };
    }

    // 8c. Validate content-type contains only printable ASCII (0x20-0x7E)
    for (let i = 0; i < actualCtLen; i++) {
      const b = ctSlice[i]!;
      if (b < 0x20 || b > 0x7e) {
        return {
          valid: false,
          error: `Content-type contains invalid character at offset ${i} (value=${b})`,
        };
      }
    }

    // 8d. Validate all padding bytes are zero (from actualCtLen to ctLength)
    for (let i = actualCtLen; i < ctLength; i++) {
      if (ctSlice[i] !== 0) {
        return {
          valid: false,
          error: `Content-type padding not zero at offset ${i} (value=${ctSlice[i]})`,
        };
      }
    }
  }

  // 9. Validate data section for f-node and s-node
  if (isFile || isSuccessor) {
    let dataOffset: number;
    if (isFile) {
      dataOffset = childrenEnd + ctLength;
    } else {
      // s-node: 16-byte aligned, validate padding is all zeros
      dataOffset = Math.ceil(childrenEnd / DATA_ALIGNMENT) * DATA_ALIGNMENT;
      for (let i = childrenEnd; i < dataOffset; i++) {
        if (bytes[i] !== 0) {
          return {
            valid: false,
            error: `Alignment padding not zero at offset ${i} (value=${bytes[i]})`,
          };
        }
      }
    }
    if (dataOffset > bytes.length) {
      return {
        valid: false,
        error: `Data offset exceeds buffer (offset=${dataOffset}, length=${bytes.length})`,
      };
    }

    // 9b. Validate leaf node size equals data length
    const dataLength = bytes.length - dataOffset;
    if (header.count === 0 && header.size !== dataLength) {
      return {
        valid: false,
        error: `Leaf node size mismatch: header.size=${header.size}, data.length=${dataLength}`,
      };
    }
  }

  // 10. Validate Pascal strings for d-node names
  let childNames: string[] = [];
  if (isDict && header.count > 0) {
    // Names section starts right after children
    const namesOffset = childrenEnd;
    const [valid, error, names] = validatePascalStringsWithNames(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
    childNames = names!;
  }

  // 11. Validate d-node children are sorted by name (UTF-8 byte order) and no duplicates
  if (isDict && childNames.length > 1) {
    const textEncoder = new TextEncoder();
    for (let i = 0; i < childNames.length - 1; i++) {
      const current = textEncoder.encode(childNames[i]!);
      const next = textEncoder.encode(childNames[i + 1]!);
      const cmp = compareBytes(current, next);
      if (cmp === 0) {
        return {
          valid: false,
          error: `Duplicate child name: "${childNames[i]}"`,
        };
      }
      if (cmp > 0) {
        return {
          valid: false,
          error: `Dict children not sorted: "${childNames[i]}" should come before "${childNames[i + 1]}"`,
        };
      }
    }
  }

  // 12. Verify hash
  const actualHash = await hashProvider.sha256(bytes);
  const actualKey = hashToKey(actualHash);
  if (actualKey !== expectedKey) {
    return {
      valid: false,
      error: `Hash mismatch: expected ${expectedKey}, got ${actualKey}`,
    };
  }

  // 13. Check children exist (if checker provided)
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

  // 14. Validate dict node size (sum of children sizes)
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
  const isFile = nodeType === NODE_TYPE.FILE;
  const isSuccessor = nodeType === NODE_TYPE.SUCCESSOR;

  // 4. Validate header.length matches actual buffer length
  if (header.length !== bytes.length) {
    return {
      valid: false,
      error: `Length mismatch: header.length=${header.length}, actual=${bytes.length}`,
    };
  }

  // 5. Validate reserved bytes are zero (bytes 24-31)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const reserved1 = view.getUint32(24, true);
  const reserved2 = view.getUint32(28, true);
  if (reserved1 !== 0 || reserved2 !== 0) {
    return {
      valid: false,
      error: `Reserved bytes not zero: [${reserved1}, ${reserved2}]`,
    };
  }

  // 6. Validate children section
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return { valid: false, error: "Children section exceeds buffer" };
  }

  // 7. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 8. Validate CT_LENGTH field
  const ctLength = getContentTypeLength(header.flags);

  // 8a. For non-f-node (d-node, s-node), CT_LENGTH must be 0
  if (!isFile && ctLength !== 0) {
    return {
      valid: false,
      error: `Non-file node must have CT_LENGTH=0, got ${ctLength}`,
    };
  }

  // 8b. For f-node, validate content-type section and minimal slot requirement
  if (isFile && ctLength > 0) {
    const ctEnd = childrenEnd + ctLength;
    if (ctEnd > bytes.length) {
      return {
        valid: false,
        error: `Content-type section exceeds buffer (need ${ctEnd}, have ${bytes.length})`,
      };
    }

    // Read content-type slot
    const ctSlice = bytes.subarray(childrenEnd, ctEnd);

    // Find actual content-type length (first null or slot end)
    let actualCtLen = ctSlice.indexOf(0);
    if (actualCtLen === -1) actualCtLen = ctLength;

    // Check minimal slot requirement for hash uniqueness
    const minimalSlot = actualCtLen === 0 ? 0 : actualCtLen <= 16 ? 16 : actualCtLen <= 32 ? 32 : 64;
    if (ctLength !== minimalSlot) {
      return {
        valid: false,
        error: `Content-type slot over-allocated: length ${actualCtLen} requires slot ${minimalSlot}, got ${ctLength}`,
      };
    }

    // 8c. Validate content-type contains only printable ASCII (0x20-0x7E)
    for (let i = 0; i < actualCtLen; i++) {
      const b = ctSlice[i]!;
      if (b < 0x20 || b > 0x7e) {
        return {
          valid: false,
          error: `Content-type contains invalid character at offset ${i} (value=${b})`,
        };
      }
    }

    // 8d. Validate all padding bytes are zero (from actualCtLen to ctLength)
    for (let i = actualCtLen; i < ctLength; i++) {
      if (ctSlice[i] !== 0) {
        return {
          valid: false,
          error: `Content-type padding not zero at offset ${i} (value=${ctSlice[i]})`,
        };
      }
    }
  }

  // 9. Validate data section for f-node and s-node
  if (isFile || isSuccessor) {
    let dataOffset: number;
    if (isFile) {
      dataOffset = childrenEnd + ctLength;
    } else {
      // s-node: 16-byte aligned, validate padding is all zeros
      dataOffset = Math.ceil(childrenEnd / DATA_ALIGNMENT) * DATA_ALIGNMENT;
      for (let i = childrenEnd; i < dataOffset; i++) {
        if (bytes[i] !== 0) {
          return {
            valid: false,
            error: `Alignment padding not zero at offset ${i} (value=${bytes[i]})`,
          };
        }
      }
    }
    if (dataOffset > bytes.length) {
      return {
        valid: false,
        error: `Data offset exceeds buffer (offset=${dataOffset}, length=${bytes.length})`,
      };
    }

    // 9b. Validate leaf node size equals data length
    const dataLength = bytes.length - dataOffset;
    if (header.count === 0 && header.size !== dataLength) {
      return {
        valid: false,
        error: `Leaf node size mismatch: header.size=${header.size}, data.length=${dataLength}`,
      };
    }
  }

  // 10. Validate Pascal strings for d-node names and check sorting
  if (isDict && header.count > 0) {
    const namesOffset = childrenEnd;
    const [valid, error, names] = validatePascalStringsWithNames(bytes, namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }

    // 11. Validate d-node children are sorted by name (UTF-8 byte order) and no duplicates
    if (names!.length > 1) {
      const textEncoder = new TextEncoder();
      for (let i = 0; i < names!.length - 1; i++) {
        const current = textEncoder.encode(names![i]!);
        const next = textEncoder.encode(names![i + 1]!);
        const cmp = compareBytes(current, next);
        if (cmp === 0) {
          return {
            valid: false,
            error: `Duplicate child name: "${names![i]}"`,
          };
        }
        if (cmp > 0) {
          return {
            valid: false,
            error: `Dict children not sorted: "${names![i]}" should come before "${names![i + 1]}"`,
          };
        }
      }
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}
