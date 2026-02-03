/**
 * Chunks controller
 */

import {
  decodeNode,
  hashToKey,
  validateNode,
  validateNodeStructure,
} from "@agent-web-portal/cas-core";
import type { HashProvider, StorageProvider } from "@agent-web-portal/cas-storage-core";
import type { Context } from "hono";
import type { OwnershipDb } from "../db/ownership.ts";
import type { RefCountDb } from "../db/refcount.ts";
import type { UsageDb } from "../db/usage.ts";
import { checkTicketWriteQuota } from "../middleware/ticket-auth.ts";
import type { Env, TreeNodeInfo, TreeResponse } from "../types.ts";
import { extractTokenId } from "../util/token-id.ts";

export type ChunksController = {
  prepareNodes: (c: Context<Env>) => Promise<Response>;
  put: (c: Context<Env>) => Promise<Response>;
  get: (c: Context<Env>) => Promise<Response>;
  getMetadata: (c: Context<Env>) => Promise<Response>;
};

type ChunksControllerDeps = {
  storage: StorageProvider;
  hashProvider: HashProvider;
  ownershipDb: OwnershipDb;
  refCountDb: RefCountDb;
  usageDb: UsageDb;
};

export const createChunksController = (deps: ChunksControllerDeps): ChunksController => {
  const { storage, hashProvider, ownershipDb, refCountDb, usageDb } = deps;

  const getRealm = (c: Context<Env>): string => {
    return c.req.param("realmId") ?? c.get("auth").realm;
  };

  // Normalize node key (strip node: prefix)
  const normalizeKey = (key: string): string => (key.startsWith("node:") ? key.slice(5) : key);

  return {
    prepareNodes: async (c) => {
      const realm = getRealm(c);
      const body = await c.req.json();
      const keys = body.keys as string[];

      if (!keys || keys.length === 0) {
        return c.json({ error: "invalid_request", message: "keys array is required" }, 400);
      }

      // Validate key format: node:{64 hex chars} or plain 64 hex chars
      const validKeyRegex = /^(node:)?[0-9a-f]{64}$/i;
      for (const key of keys) {
        if (!validKeyRegex.test(key)) {
          return c.json(
            { error: "invalid_request", message: `Invalid node key format: ${key}` },
            400
          );
        }
      }

      // Normalize keys (strip node: prefix for storage lookup)

      // Check which nodes are missing
      const missing: string[] = [];
      const exists: string[] = [];

      for (const key of keys) {
        const normalizedKey = normalizeKey(key);
        const hasNode = await ownershipDb.hasOwnership(realm, normalizedKey);
        if (hasNode) {
          exists.push(key);
        } else {
          missing.push(key);
        }
      }

      return c.json({ missing, exists });
    },

    put: async (c) => {
      const auth = c.get("auth");
      const realm = getRealm(c);
      const key = decodeURIComponent(c.req.param("key"));

      // Get binary content
      const arrayBuffer = await c.req.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);

      if (bytes.length === 0) {
        return c.json({ error: "Empty body" }, 400);
      }

      // Check ticket quota
      if (!checkTicketWriteQuota(auth, bytes.length)) {
        return c.json(
          {
            error: "TICKET_QUOTA_EXCEEDED",
            message: "Upload size exceeds ticket quota",
          },
          413
        );
      }

      // Quick structure validation
      const structureResult = validateNodeStructure(bytes);
      if (!structureResult.valid) {
        return c.json({ error: "Invalid node structure", details: structureResult.error }, 400);
      }

      // Get child size helper
      const getChildSize = async (childKey: string): Promise<number | null> => {
        const childData = await storage.get(childKey);
        if (!childData) return null;
        try {
          const node = decodeNode(childData);
          return node.size;
        } catch {
          return null;
        }
      };

      // Full validation
      const validationResult = await validateNode(
        bytes,
        key,
        hashProvider,
        (childKey) => storage.has(childKey),
        structureResult.kind === "dict" ? getChildSize : undefined
      );

      if (!validationResult.valid) {
        if (validationResult.error?.includes("Missing children")) {
          return c.json({
            success: false,
            error: "missing_nodes",
            missing: validationResult.childKeys ?? [],
          });
        }
        return c.json({ error: "Node validation failed", details: validationResult.error }, 400);
      }

      // Calculate sizes
      const physicalSize = bytes.length;
      // File and successor nodes have data content; dict nodes are just directories
      const logicalSize =
        structureResult.kind !== "dict" ? (validationResult.size ?? bytes.length) : 0;
      const childKeys = validationResult.childKeys ?? [];

      // Check realm quota
      const existingRef = await refCountDb.getRefCount(realm, key);
      const estimatedNewBytes = existingRef ? 0 : physicalSize;

      if (estimatedNewBytes > 0) {
        const { allowed, usage } = await usageDb.checkQuota(realm, estimatedNewBytes);
        if (!allowed) {
          return c.json(
            {
              error: "REALM_QUOTA_EXCEEDED",
              message: "Upload would exceed realm storage quota",
              details: {
                limit: usage.quotaLimit,
                used: usage.physicalBytes,
                requested: estimatedNewBytes,
              },
            },
            403
          );
        }
      }

      // Store the node
      await storage.put(key, bytes);

      // Add ownership
      const tokenId = extractTokenId(auth.token.pk);
      // NodeKind from cas-core matches our local type
      await ownershipDb.addOwnership(
        realm,
        key,
        tokenId,
        "application/octet-stream",
        validationResult.size ?? bytes.length,
        validationResult.kind
      );

      // Increment reference count
      const { isNewToRealm } = await refCountDb.incrementRef(realm, key, physicalSize, logicalSize);

      // Increment ref for children
      for (const childKey of childKeys) {
        const childRef = await refCountDb.getRefCount(realm, childKey);
        if (childRef) {
          await refCountDb.incrementRef(
            realm,
            childKey,
            childRef.physicalSize,
            childRef.logicalSize
          );
        }
      }

      // Update usage
      if (isNewToRealm) {
        await usageDb.updateUsage(realm, {
          physicalBytes: physicalSize,
          logicalBytes: logicalSize,
          nodeCount: 1,
        });
      }

      return c.json({
        key,
        size: validationResult.size,
        kind: validationResult.kind,
      });
    },

    get: async (c) => {
      const realm = getRealm(c);
      const rawKey = decodeURIComponent(c.req.param("key"));
      const key = normalizeKey(rawKey);

      // Check ownership
      const hasAccess = await ownershipDb.hasOwnership(realm, key);
      if (!hasAccess) {
        return c.json({ error: "not_found", message: "Node not found" }, 404);
      }

      // Get content
      const bytes = await storage.get(key);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Node content not found" }, 404);
      }

      // Decode metadata
      let kind: string | undefined;
      let size: number | undefined;
      let contentType: string | undefined;
      try {
        const node = decodeNode(bytes);
        kind = node.kind;
        size = node.size;
        contentType = node.fileInfo?.contentType;
      } catch {
        // If decode fails, just return raw
      }

      const headers: Record<string, string> = {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
      };
      if (kind) headers["X-CAS-Kind"] = kind;
      if (size !== undefined) headers["X-CAS-Size"] = String(size);
      if (contentType) headers["X-CAS-Content-Type"] = contentType;

      return new Response(bytes, { status: 200, headers });
    },

    getMetadata: async (c) => {
      const realm = getRealm(c);
      const rawKey = decodeURIComponent(c.req.param("key"));
      const key = normalizeKey(rawKey);

      // Check ownership
      const hasAccess = await ownershipDb.hasOwnership(realm, key);
      if (!hasAccess) {
        return c.json({ error: "not_found", message: "Node not found" }, 404);
      }

      // Get content
      const bytes = await storage.get(key);
      if (!bytes) {
        return c.json({ error: "not_found", message: "Node content not found" }, 404);
      }

      try {
        const node = decodeNode(bytes);

        if (node.kind === "dict") {
          // d-node: directory
          const children: Record<string, string> = {};
          if (node.children && node.childNames) {
            for (let i = 0; i < node.childNames.length; i++) {
              const name = node.childNames[i];
              const childHash = node.children[i];
              if (name && childHash) {
                children[name] = hashToKey(childHash);
              }
            }
          }
          return c.json({
            kind: "dict",
            size: node.size,
            children,
          });
        }

        if (node.kind === "file") {
          // f-node: file
          return c.json({
            kind: "file",
            size: node.size,
            contentType: node.fileInfo?.contentType,
          });
        }

        if (node.kind === "successor") {
          // s-node: continuation
          return c.json({
            kind: "successor",
            size: node.size,
            next: node.children?.[0] ? hashToKey(node.children[0]) : undefined,
          });
        }

        return c.json({ error: "invalid_node", message: "Unknown node kind" }, 400);
      } catch {
        return c.json({ error: "invalid_node", message: "Failed to decode node" }, 400);
      }
    },
  };
};
