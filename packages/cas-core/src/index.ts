/**
 * @agent-web-portal/cas-core
 *
 * CAS binary format encoding/decoding library
 */

// Constants
export {
  DEFAULT_NODE_LIMIT,
  FLAGS,
  HASH_SIZE,
  HEADER_SIZE,
  MAGIC,
  MAGIC_BYTES,
  MAX_SAFE_SIZE,
} from "./constants.ts";

// Types
export type {
  CasHeader,
  CasNode,
  ChunkInput,
  CollectionInput,
  EncodedNode,
  HashProvider,
  LayoutNode,
  NodeKind,
  StorageProvider,
} from "./types.ts";

// Header encoding/decoding
export {
  createChunkHeader,
  createCollectionHeader,
  decodeHeader,
  encodeHeader,
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
  encodeChunk,
  encodeChunkWithSize,
  encodeCollection,
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

// Controller
export {
  CasController,
  type CasControllerConfig,
  type CollectionEntry,
  type TreeNodeInfo,
  type TreeResponse,
  type WriteResult,
} from "./controller.ts";

// Providers
export {
  MemoryStorageProvider,
  WebCryptoHashProvider,
} from "./providers.ts";

// Validation
export {
  validateNode,
  validateNodeStructure,
  type ExistsChecker,
  type ValidationResult,
} from "./validation.ts";
