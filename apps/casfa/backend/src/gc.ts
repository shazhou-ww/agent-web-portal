/**
 * CAS Stack - Garbage Collection
 *
 * Runs periodically to clean up nodes with zero references.
 * - Respects protection period (default 72 hours)
 * - Processes in batches to avoid timeout
 * - Recursively decrements children references
 * - Deletes S3 blobs when global reference count reaches zero
 */

import { decodeNode } from "@agent-web-portal/cas-core";
import { S3StorageProvider } from "./cas/providers.ts";
import { CasStorage } from "./cas/storage.ts";
import { RefCountDb } from "./db/refcount.ts";
import { UsageDb } from "./db/usage.ts";
import type { CasConfig, RefCount } from "./types.ts";
import { loadConfig } from "./types.ts";

/**
 * GC configuration from environment variables
 */
interface GcConfig {
  /** Protection period in hours (default 72) */
  protectionHours: number;
  /** Max nodes per batch (default 100) */
  batchSize: number;
  /** Max batches per run (default 50) */
  maxBatches: number;
}

function loadGcConfig(): GcConfig {
  return {
    protectionHours: parseInt(process.env.GC_PROTECTION_HOURS ?? "72", 10),
    batchSize: parseInt(process.env.GC_BATCH_SIZE ?? "100", 10),
    maxBatches: parseInt(process.env.GC_MAX_BATCHES ?? "50", 10),
  };
}

/**
 * GC run statistics
 */
export interface GcStats {
  nodesProcessed: number;
  bytesReclaimed: number;
  blobsDeleted: number;
  errors: string[];
  durationMs: number;
}

/**
 * Run garbage collection
 */
export async function runGc(config?: CasConfig): Promise<GcStats> {
  const startTime = Date.now();
  const casConfig = config ?? loadConfig();
  const gcConfig = loadGcConfig();

  const refCountDb = new RefCountDb(casConfig);
  const usageDb = new UsageDb(casConfig);
  const storageProvider = new S3StorageProvider({ bucket: casConfig.casBucket });
  const casStorage = new CasStorage(casConfig);

  const protectionPeriodMs = gcConfig.protectionHours * 3600 * 1000;
  const threshold = Date.now() - protectionPeriodMs;

  const stats: GcStats = {
    nodesProcessed: 0,
    bytesReclaimed: 0,
    blobsDeleted: 0,
    errors: [],
    durationMs: 0,
  };

  let lastKey: string | undefined;

  console.log(`[GC] Starting garbage collection`);
  console.log(`[GC] Protection period: ${gcConfig.protectionHours} hours`);
  console.log(`[GC] Batch size: ${gcConfig.batchSize}, Max batches: ${gcConfig.maxBatches}`);

  for (let batch = 0; batch < gcConfig.maxBatches; batch++) {
    // Query pending GC nodes
    const { items, nextKey } = await refCountDb.listPendingGC({
      beforeTime: threshold,
      limit: gcConfig.batchSize,
      startKey: lastKey,
    });

    if (items.length === 0) {
      console.log(`[GC] No more pending nodes`);
      break;
    }

    console.log(`[GC] Processing batch ${batch + 1}: ${items.length} nodes`);

    for (const item of items) {
      try {
        await processGcNode(item, refCountDb, usageDb, storageProvider, casStorage, stats);
        stats.nodesProcessed++;
      } catch (error) {
        const errorMsg = `Failed to process ${item.key}: ${error}`;
        console.error(`[GC] ${errorMsg}`);
        stats.errors.push(errorMsg);
      }
    }

    lastKey = nextKey;
    if (!nextKey) {
      console.log(`[GC] No more pages`);
      break;
    }
  }

  stats.durationMs = Date.now() - startTime;

  console.log(`[GC] Completed in ${stats.durationMs}ms`);
  console.log(`[GC] Nodes processed: ${stats.nodesProcessed}`);
  console.log(`[GC] Bytes reclaimed: ${stats.bytesReclaimed}`);
  console.log(`[GC] Blobs deleted: ${stats.blobsDeleted}`);
  if (stats.errors.length > 0) {
    console.log(`[GC] Errors: ${stats.errors.length}`);
  }

  return stats;
}

/**
 * Process a single node for GC
 */
async function processGcNode(
  item: RefCount,
  refCountDb: RefCountDb,
  usageDb: UsageDb,
  storageProvider: S3StorageProvider,
  casStorage: CasStorage,
  stats: GcStats
): Promise<void> {
  const { realm, key, physicalSize, logicalSize } = item;

  console.log(`[GC] Processing node: ${key} (realm: ${realm})`);

  // Read node to get children
  const nodeBytes = await storageProvider.get(key);
  if (nodeBytes) {
    try {
      const node = decodeNode(nodeBytes);
      const children = node.children ?? [];

      // Decrement reference count for each child
      for (const childHash of children) {
        const childKey = `sha256:${Buffer.from(childHash).toString("hex")}`;
        await refCountDb.decrementRef(realm, childKey);
        console.log(`[GC]   Decremented child ref: ${childKey}`);
      }
    } catch (error) {
      console.warn(`[GC] Failed to decode node ${key}: ${error}`);
    }
  }

  // Update realm usage
  await usageDb.updateUsage(realm, {
    physicalBytes: -physicalSize,
    logicalBytes: -logicalSize,
    nodeCount: -1,
  });
  stats.bytesReclaimed += physicalSize;

  // Delete RefCount record
  await refCountDb.deleteRefCount(realm, key);

  // Check if S3 blob can be deleted (no references from any realm)
  const globalRefs = await refCountDb.countGlobalRefs(key);
  if (globalRefs === 0) {
    console.log(`[GC]   Deleting S3 blob: ${key}`);
    await casStorage.delete(key);
    stats.blobsDeleted++;
  }
}

/**
 * Lambda handler for scheduled GC
 */
export async function handler(event: unknown): Promise<{ statusCode: number; body: string }> {
  console.log(`[GC] Lambda invoked with event:`, JSON.stringify(event));

  try {
    const stats = await runGc();

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        stats,
      }),
    };
  } catch (error) {
    console.error(`[GC] Lambda failed:`, error);

    return {
      statusCode: 500,
      body: JSON.stringify({
        success: false,
        error: String(error),
      }),
    };
  }
}
