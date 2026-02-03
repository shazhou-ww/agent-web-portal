/**
 * @agent-web-portal/cas-core
 *
 * CAS binary format encoding/decoding library (v2.1)
 *
 * Node types:
 * - d-node (dict): directory with sorted children by name
 * - s-node (successor): file continuation chunk
 * - f-node (file): file top-level node with FileInfo
 */

// Constants
export {
  CONTENT_TYPE_MAX_LENGTH,
  DEFAULT_NODE_LIMIT,
  FILEINFO_SIZE,
  FLAGS,
  HASH_ALGO,
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
  FileInfo,
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
  getBlockSizeLimit,
  getExtensionCount,
  getHashAlgo,
  getNodeType,
  setBlockSizeLimit,
  setExtensionCount,
  setHashAlgo,
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
  encodeSuccessorNode,
  getNodeKind,
  isValidNode,
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
  makeDict,
  openFileStream,
  putFileNode,
  readFile,
  writeFile,
  // Types
  type CasContext,
  type DictEntry,
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
  EMPTY_DICT_BYTES,
  EMPTY_DICT_KEY,
  WELL_KNOWN_KEYS,
} from "./well-known.ts";
