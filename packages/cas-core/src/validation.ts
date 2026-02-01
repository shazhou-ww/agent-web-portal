/**
 * CAS Node Validation
 *
 * Strict validation for server-side use:
 * - Magic and header structure
 * - Hash matches content
 * - All children exist
 * - Pascal strings are valid
 * - Size is correct for collections
 */

import { FLAGS, HASH_SIZE, HEADER_SIZE, MAGIC_BYTES } from "./constants.ts";
import { decodeHeader } from "./header.ts";
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

  const isCollection = (header.flags & FLAGS.HAS_NAMES) !== 0;
  const hasType = (header.flags & FLAGS.HAS_TYPE) !== 0;
  const hasData = (header.flags & FLAGS.HAS_DATA) !== 0;
  const kind: NodeKind = isCollection ? "collection" : "chunk";

  // 4. Validate offsets are within bounds
  const childrenEnd = HEADER_SIZE + header.count * HASH_SIZE;
  if (childrenEnd > bytes.length) {
    return {
      valid: false,
      error: `Children section exceeds buffer (need ${childrenEnd}, have ${bytes.length})`,
    };
  }

  if (isCollection && header.namesOffset > 0) {
    if (header.namesOffset < childrenEnd) {
      return {
        valid: false,
        error: `Names offset ${header.namesOffset} overlaps with children section`,
      };
    }
    if (header.namesOffset >= bytes.length) {
      return { valid: false, error: `Names offset ${header.namesOffset} out of bounds` };
    }
  }

  if (hasType && header.typeOffset > 0) {
    if (header.typeOffset >= bytes.length) {
      return { valid: false, error: `Type offset ${header.typeOffset} out of bounds` };
    }
  }

  if (hasData && header.dataOffset > 0) {
    if (header.dataOffset > bytes.length) {
      return { valid: false, error: `Data offset ${header.dataOffset} out of bounds` };
    }
  }

  // 5. Extract child keys
  const childKeys: string[] = [];
  for (let i = 0; i < header.count; i++) {
    const offset = HEADER_SIZE + i * HASH_SIZE;
    const hashBytes = bytes.slice(offset, offset + HASH_SIZE);
    childKeys.push(hashToKey(hashBytes));
  }

  // 6. Validate Pascal strings
  if (isCollection && header.count > 0) {
    const [valid, error] = validatePascalStrings(bytes, header.namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
  }

  if (hasType && header.typeOffset > 0) {
    const [valid, , error] = validatePascalString(bytes, header.typeOffset);
    if (!valid) {
      return { valid: false, error: `Invalid content-type: ${error}` };
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

  // 9. Validate collection size (sum of children sizes)
  if (isCollection && getSize && childKeys.length > 0) {
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
        error: `Collection size mismatch: header=${header.size}, computed=${expectedSize}`,
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

  const isCollection = (header.flags & FLAGS.HAS_NAMES) !== 0;
  const hasType = (header.flags & FLAGS.HAS_TYPE) !== 0;
  const hasData = (header.flags & FLAGS.HAS_DATA) !== 0;
  const kind: NodeKind = isCollection ? "collection" : "chunk";

  // 4. Validate offsets
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

  // 6. Validate Pascal strings
  if (isCollection && header.count > 0 && header.namesOffset > 0) {
    const [valid, error] = validatePascalStrings(bytes, header.namesOffset, header.count);
    if (!valid) {
      return { valid: false, error: `Invalid names: ${error}` };
    }
  }

  if (hasType && header.typeOffset > 0) {
    const [valid, , error] = validatePascalString(bytes, header.typeOffset);
    if (!valid) {
      return { valid: false, error: `Invalid content-type: ${error}` };
    }
  }

  return {
    valid: true,
    kind,
    size: header.size,
    childKeys,
  };
}
