/**
 * Node API functions with local caching support.
 */

import type { NodeMetadata, PrepareNodesResult } from "../types/api.ts";
import type { HashProvider, StorageProvider } from "../types/providers.ts";
import type { Fetcher, FetchResult } from "../utils/fetch.ts";

/**
 * Node API context.
 */
export type NodeApiContext = {
  fetcher: Fetcher;
  realmId: string;
  storage?: StorageProvider;
  hash?: HashProvider;
};

/**
 * Convert bytes to hex string.
 */
const bytesToHex = (bytes: Uint8Array): string => {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
};

/**
 * Prepare nodes for upload (check which ones already exist).
 */
export type PrepareNodesParams = {
  keys: string[];
};

export const prepareNodes = async (
  ctx: NodeApiContext,
  params: PrepareNodesParams
): Promise<FetchResult<PrepareNodesResult>> => {
  // Check local cache first
  const keysToCheck: string[] = [];
  const cachedKeys: string[] = [];

  if (ctx.storage) {
    for (const key of params.keys) {
      const exists = await ctx.storage.has(key);
      if (exists) {
        cachedKeys.push(key);
      } else {
        keysToCheck.push(key);
      }
    }
  } else {
    keysToCheck.push(...params.keys);
  }

  // If all keys are cached, return immediately
  if (keysToCheck.length === 0) {
    return {
      ok: true,
      data: { exists: params.keys, missing: [] },
      status: 200,
    };
  }

  // Check server for remaining keys
  const result = await ctx.fetcher.request<PrepareNodesResult>(
    `/api/realm/${ctx.realmId}/prepare-nodes`,
    {
      method: "POST",
      body: { keys: keysToCheck },
    }
  );

  if (!result.ok) {
    return result;
  }

  // Merge cached keys with server response
  return {
    ok: true,
    data: {
      exists: [...cachedKeys, ...result.data.exists],
      missing: result.data.missing,
    },
    status: result.status,
  };
};

/**
 * Get node metadata.
 */
export type GetNodeMetadataParams = {
  key: string;
};

export const getNodeMetadata = async (
  ctx: NodeApiContext,
  params: GetNodeMetadataParams
): Promise<FetchResult<NodeMetadata>> => {
  return ctx.fetcher.request<NodeMetadata>(
    `/api/realm/${ctx.realmId}/nodes/${params.key}/metadata`
  );
};

/**
 * Get node binary data.
 */
export type GetNodeParams = {
  key: string;
};

export const getNode = async (
  ctx: NodeApiContext,
  params: GetNodeParams
): Promise<FetchResult<Uint8Array>> => {
  // Check local cache first
  if (ctx.storage) {
    const cached = await ctx.storage.get(params.key);
    if (cached) {
      return { ok: true, data: cached, status: 200 };
    }
  }

  // Fetch from server
  const result = await ctx.fetcher.downloadBinary(`/api/realm/${ctx.realmId}/nodes/${params.key}`);

  // Cache the result
  if (result.ok && ctx.storage) {
    await ctx.storage.put(params.key, result.data);
  }

  return result;
};

/**
 * Upload node binary data.
 */
export type PutNodeParams = {
  key: string;
  data: Uint8Array;
  contentMd5?: string;
  blake3Hash?: string;
};

export const putNode = async (
  ctx: NodeApiContext,
  params: PutNodeParams
): Promise<FetchResult<{ key: string }>> => {
  const headers: Record<string, string> = {};

  if (params.contentMd5) {
    headers["Content-MD5"] = params.contentMd5;
  }
  if (params.blake3Hash) {
    headers["X-CAS-Blake3"] = params.blake3Hash;
  }

  const result = await ctx.fetcher.uploadBinary(
    `/api/realm/${ctx.realmId}/nodes/${params.key}`,
    params.data,
    { headers }
  );

  // Cache the uploaded node
  if (result.ok && ctx.storage) {
    await ctx.storage.put(params.key, params.data);
  }

  return result as FetchResult<{ key: string }>;
};

/**
 * Upload node with automatic hash computation.
 */
export type UploadNodeParams = {
  data: Uint8Array;
};

export const uploadNode = async (
  ctx: NodeApiContext,
  params: UploadNodeParams
): Promise<FetchResult<{ key: string }>> => {
  if (!ctx.hash) {
    return {
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "HashProvider required for uploadNode",
      },
    };
  }

  const hashBytes = await ctx.hash.sha256(params.data);
  const key = bytesToHex(hashBytes);

  // Check if already exists
  if (ctx.storage) {
    const exists = await ctx.storage.has(key);
    if (exists) {
      return { ok: true, data: { key }, status: 200 };
    }
  }

  return putNode(ctx, { key, data: params.data });
};
