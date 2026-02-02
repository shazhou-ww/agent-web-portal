/**
 * @agent-web-portal/cas-core
 *
 * CAS binary format encoding/decoding library (v2)
 *
 * Node types:
 * - d-node (dict): directory with sorted children by name
 * - s-node (successor): file continuation chunk
 * - f-node (file): file top-level node with content-type
 */

// Constants
export {
  CONTENT_TYPE_LENGTH,
  CONTENT_TYPE_LENGTH_VALUES,
  DATA_ALIGNMENT,
  DEFAULT_NODE_LIMIT,
  FLAGS,
  HASH_SIZE,
  HEADER_SIZE,
  MAGIC,
  MAGIC_BYTES,
  MAX_SAFE_SIZE,
  NODE_TYPE,
} from "./constants.ts";

// Types
export type {
  CasHeader,
  CasNode,
  DictNodeInput,
  EncodedNode,
  FileNodeInput,
  HashProvider,
  LayoutNode,
  NodeKind,
  StorageProvider,
  SuccessorNodeInput,
} from "./types.ts";

// Header encoding/decoding
export {
  buildDictFlags,
  buildFileFlags,
  buildSuccessorFlags,
  createDictHeader,
  createFileHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getContentTypeLength,
  getNodeType,
} from "./header.ts";

// Topology algorithms
export {
  computeCapacity,
  computeDepth,
  computeLayout,
  computeLayoutSize,
  computeUsableSpace,
  countLayoutNodes,
  validateLayout,
} from "./topology.ts";

// Node encoding/decoding
export {
  decodeNode,
  encodeDictNode,
  encodeFileNode,
  encodeFileNodeWithSize,
  encodeSuccessorNode,
  encodeSuccessorNodeWithSize,
  getNodeKind,
  isValidNode,
  // Legacy aliases
  encodeChunk,
  encodeChunkWithSize,
  encodeCollection,
} from "./node.ts";

// Utility functions
export {
  bytesToHex,
  concatBytes,
  decodePascalString,
  decodePascalStrings,
  encodePascalString,
  encodePascalStrings,
  hashToKey,
  hexToBytes,
  keyToHash,
} from "./utils.ts";

// Controller - Functional API
export {
  // Functions
  getChunk,
  getNode,
  getNodeLimit,
  getTree,
  has,
  makeCollection,
  openFileStream,
  putFileNode,
  readFile,
  writeFile,
  // Types
  type CasContext,
  type CollectionEntry,
  type TreeNodeInfo,
  type TreeResponse,
  type WriteResult,
} from "./controller.ts";

// Providers - Functional API
export {
  // Functional factories
  createMemoryStorage,
  createWebCryptoHash,
  type MemoryStorage,
} from "./providers.ts";

// Validation
export {
  validateNode,
  validateNodeStructure,
  type ExistsChecker,
  type ValidationResult,
} from "./validation.ts";

// Well-known keys and data
export {
  EMPTY_COLLECTION_BYTES,
  EMPTY_COLLECTION_KEY,
  WELL_KNOWN_KEYS,
} from "./well-known.ts";
