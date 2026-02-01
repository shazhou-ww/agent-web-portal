/**
 * CAS Client Core
 *
 * Platform-agnostic types and utilities for CAS clients
 */

// Blob reference utilities
export {
  buildEndpoint,
  createBlobRef,
  extractPaths,
  isBlobRef,
  parseEndpoint,
  resolvePath,
  resolvePathRaw,
} from "./blob-ref.ts";
// Client
export { CasClient } from "./client.ts";

// Hash utilities
export { computeChunkKeys, computeKey, extractHash, isValidKey } from "./hash.ts";

// Stream utilities
export {
  bytesAsStream,
  chunksAsStream,
  collectBytes,
  concatBytes,
  concatStreamFactories,
  concatStreams,
  needsChunking,
  sliceStream,
  splitIntoChunks,
} from "./stream.ts";

// Types
export type {
  ByteStream,
  ByteStreamFactory,
  CasAuth,
  CasBlobRef,
  CasClientConfig,
  CasCollectionNode,
  CasConfigResponse,
  CasEndpointInfo,
  CasFileHandle,
  CasFileNode,
  CasNode,
  CasRawChunkNode,
  CasRawCollectionNode,
  CasRawFileNode,
  CasRawNode,
  LocalStorageProvider,
  NodeKind,
  ParsedEndpoint,
  PathResolution,
  PathResolver,
  PutChunkResponse,
  PutCollectionResponse,
  PutFileResponse,
  RawResponse,
  TreeNodeInfo,
  TreeResponse,
} from "./types.ts";

// Constants
export { CAS_CONTENT_TYPES, CAS_HEADERS } from "./types.ts";
