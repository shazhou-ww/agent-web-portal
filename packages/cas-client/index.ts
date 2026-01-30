/**
 * CAS Client
 *
 * A streaming-capable client for Content-Addressable Storage (CAS).
 * Supports three authentication modes: User Token, Agent Token, and Ticket.
 */

export {
  computeKey,
  needsChunking,
  splitIntoChunks,
  streamToBuffer,
} from "./src/chunker.ts";
export { CasClient } from "./src/client.ts";
export { CasFileHandleImpl } from "./src/file-handle.ts";
export { FileSystemStorageProvider } from "./src/storage.ts";

export type {
  // Auth types
  CasAuth,
  CasBlobContext,
  CasClientConfig,
  CasCollectionNode,
  // API response types
  CasConfigResponse,
  // Handle types
  CasFileHandle,
  CasFileNode,
  CasNode,
  CasRawChunkNode,
  CasRawCollectionNode,
  CasRawFileNode,
  CasRawNode,
  // Storage provider
  LocalStorageProvider,
  // Node types
  NodeKind,
  // Path resolution
  PathResolution,
  PathResolver,
  PutChunkResponse,
  PutCollectionResponse,
  PutFileResponse,
} from "./src/types.ts";
