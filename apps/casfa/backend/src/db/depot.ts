/**
 * CAS Stack - Database Operations for Depots
 *
 * Depots are persistent named tree structures within a realm.
 * Each depot maintains a history of all root changes.
 *
 * Uses CasRealmTable with key prefixes:
 * - "DEPOT#${depotId}" for depot records
 * - "DEPOT-HISTORY#${depotId}#${version}" for history records
 */

import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CasConfig } from "../types.ts";
import { createDynamoDBClient } from "./client.ts";

// ============================================================================
// Constants
// ============================================================================

/** Prefix for depot keys in CasRealmTable */
const DEPOT_KEY_PREFIX = "DEPOT#";

/** Prefix for depot history keys in CasRealmTable */
const DEPOT_HISTORY_PREFIX = "DEPOT-HISTORY#";

/** Name of the default depot that cannot be deleted */
export const MAIN_DEPOT_NAME = "main";

// ============================================================================
// Types
// ============================================================================

/**
 * Depot record - a named persistent tree in a realm
 */
export interface DepotRecord {
  /** Partition key: realm ID (e.g., "usr_xxx") */
  realm: string;
  /** Sort key: "DEPOT#${depotId}" */
  key: string;
  /** System-generated depot ID */
  depotId: string;
  /** User-readable name (e.g., "main", "backup") */
  name: string;
  /** Current root node key */
  root: string;
  /** Current version number */
  version: number;
  /** Creation timestamp */
  createdAt: number;
  /** Last update timestamp */
  updatedAt: number;
  /** Optional description */
  description?: string;
}

/**
 * Depot history record - tracks a version of a depot
 */
export interface DepotHistoryRecord {
  /** Partition key: realm ID */
  realm: string;
  /** Sort key: "DEPOT-HISTORY#${depotId}#${version}" (zero-padded) */
  key: string;
  /** Depot ID */
  depotId: string;
  /** Version number */
  version: number;
  /** Root node key at this version */
  root: string;
  /** Timestamp when this version was created */
  createdAt: number;
  /** Optional commit message */
  message?: string;
}

/**
 * Options for creating a depot
 */
export interface CreateDepotOptions {
  name: string;
  root: string;
  description?: string;
}

/**
 * Options for listing depots
 */
export interface ListDepotsOptions {
  limit?: number;
  startKey?: string;
}

/**
 * Result of listing depots
 */
export interface ListDepotsResult {
  depots: DepotRecord[];
  nextKey?: string;
}

/**
 * Options for listing depot history
 */
export interface ListHistoryOptions {
  limit?: number;
  startKey?: string;
  /** If true, return oldest first instead of newest first */
  ascending?: boolean;
}

/**
 * Result of listing depot history
 */
export interface ListHistoryResult {
  history: DepotHistoryRecord[];
  nextKey?: string;
}

// ============================================================================
// DepotDb
// ============================================================================

export class DepotDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    this.tableName = config.casRealmTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(createDynamoDBClient(), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  // ==========================================================================
  // Key Building
  // ==========================================================================

  /**
   * Build the sort key for a depot record
   */
  private buildDepotKey(depotId: string): string {
    return `${DEPOT_KEY_PREFIX}${depotId}`;
  }

  /**
   * Build the sort key for a history record
   * Version is zero-padded to 10 digits for proper sorting
   */
  private buildHistoryKey(depotId: string, version: number): string {
    const paddedVersion = version.toString().padStart(10, "0");
    return `${DEPOT_HISTORY_PREFIX}${depotId}#${paddedVersion}`;
  }

  /**
   * Parse a depot key to extract depotId
   */
  private parseDepotKey(key: string): string | null {
    if (!key.startsWith(DEPOT_KEY_PREFIX)) return null;
    return key.slice(DEPOT_KEY_PREFIX.length);
  }

  /**
   * Generate a new depot ID
   */
  private generateDepotId(): string {
    return crypto.randomUUID();
  }

  // ==========================================================================
  // Depot CRUD
  // ==========================================================================

  /**
   * Create a new depot
   */
  async create(realm: string, options: CreateDepotOptions): Promise<DepotRecord> {
    const depotId = this.generateDepotId();
    const now = Date.now();

    const depot: DepotRecord = {
      realm,
      key: this.buildDepotKey(depotId),
      depotId,
      name: options.name,
      root: options.root,
      version: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description,
    };

    // Create initial history record
    const history: DepotHistoryRecord = {
      realm,
      key: this.buildHistoryKey(depotId, 1),
      depotId,
      version: 1,
      root: options.root,
      createdAt: now,
      message: "Initial creation",
    };

    // Use TransactWriteItems to ensure atomicity
    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: depot,
        ConditionExpression: "attribute_not_exists(pk)",
      })
    );

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: history,
      })
    );

    return depot;
  }

  /**
   * Get a depot by ID
   */
  async get(realm: string, depotId: string): Promise<DepotRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { realm, key: this.buildDepotKey(depotId) },
      })
    );

    return (result.Item as DepotRecord) ?? null;
  }

  /**
   * Get a depot by name
   */
  async getByName(realm: string, name: string): Promise<DepotRecord | null> {
    // Query all depots and filter by name
    // In production, consider adding a GSI for name lookup
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        FilterExpression: "#name = :name",
        ExpressionAttributeNames: {
          "#key": "key",
          "#name": "name",
        },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": DEPOT_KEY_PREFIX,
          ":name": name,
        },
        Limit: 1,
      })
    );

    if (!result.Items || result.Items.length === 0) {
      return null;
    }

    return result.Items[0] as DepotRecord;
  }

  /**
   * List all depots in a realm
   */
  async list(realm: string, options: ListDepotsOptions = {}): Promise<ListDepotsResult> {
    const { limit = 100, startKey } = options;

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: {
          "#key": "key",
        },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": DEPOT_KEY_PREFIX,
        },
        Limit: limit,
        ExclusiveStartKey: startKey
          ? { realm, key: startKey }
          : undefined,
      })
    );

    const depots = (result.Items ?? []) as DepotRecord[];
    const nextKey = result.LastEvaluatedKey?.key as string | undefined;

    return { depots, nextKey };
  }

  /**
   * Update a depot's root (creates a new version)
   */
  async updateRoot(
    realm: string,
    depotId: string,
    newRoot: string,
    message?: string
  ): Promise<{ depot: DepotRecord; history: DepotHistoryRecord }> {
    const now = Date.now();

    // Get current depot to increment version
    const current = await this.get(realm, depotId);
    if (!current) {
      throw new Error(`Depot not found: ${depotId}`);
    }

    const newVersion = current.version + 1;

    // Update depot record
    const updateResult = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { realm, key: this.buildDepotKey(depotId) },
        UpdateExpression:
          "SET #root = :root, #version = :version, #updatedAt = :updatedAt",
        ExpressionAttributeNames: {
          "#root": "root",
          "#version": "version",
          "#updatedAt": "updatedAt",
        },
        ExpressionAttributeValues: {
          ":root": newRoot,
          ":version": newVersion,
          ":updatedAt": now,
        },
        ReturnValues: "ALL_NEW",
      })
    );

    const depot = updateResult.Attributes as DepotRecord;

    // Create history record
    const history: DepotHistoryRecord = {
      realm,
      key: this.buildHistoryKey(depotId, newVersion),
      depotId,
      version: newVersion,
      root: newRoot,
      createdAt: now,
      message,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: history,
      })
    );

    return { depot, history };
  }

  /**
   * Delete a depot
   * Note: This does NOT delete history records (they are preserved)
   */
  async delete(realm: string, depotId: string): Promise<DepotRecord | null> {
    const depot = await this.get(realm, depotId);
    if (!depot) {
      return null;
    }

    // Prevent deletion of main depot
    if (depot.name === MAIN_DEPOT_NAME) {
      throw new Error("Cannot delete the main depot");
    }

    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { realm, key: this.buildDepotKey(depotId) },
      })
    );

    return depot;
  }

  // ==========================================================================
  // History Operations
  // ==========================================================================

  /**
   * Get a specific history record
   */
  async getHistory(
    realm: string,
    depotId: string,
    version: number
  ): Promise<DepotHistoryRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { realm, key: this.buildHistoryKey(depotId, version) },
      })
    );

    return (result.Item as DepotHistoryRecord) ?? null;
  }

  /**
   * List history for a depot
   * By default, returns newest versions first
   */
  async listHistory(
    realm: string,
    depotId: string,
    options: ListHistoryOptions = {}
  ): Promise<ListHistoryResult> {
    const { limit = 50, startKey, ascending = false } = options;

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: {
          "#key": "key",
        },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": `${DEPOT_HISTORY_PREFIX}${depotId}#`,
        },
        Limit: limit,
        ScanIndexForward: ascending,
        ExclusiveStartKey: startKey
          ? { realm, key: startKey }
          : undefined,
      })
    );

    const history = (result.Items ?? []) as DepotHistoryRecord[];
    const nextKey = result.LastEvaluatedKey?.key as string | undefined;

    return { history, nextKey };
  }

  // ==========================================================================
  // Main Depot Management
  // ==========================================================================

  /**
   * Ensure the main depot exists for a realm
   * Creates it with the empty collection as root if it doesn't exist
   */
  async ensureMainDepot(realm: string, emptyCollectionKey: string): Promise<DepotRecord> {
    const existing = await this.getByName(realm, MAIN_DEPOT_NAME);
    if (existing) {
      return existing;
    }

    return await this.create(realm, {
      name: MAIN_DEPOT_NAME,
      root: emptyCollectionKey,
      description: "Default depot",
    });
  }
}
