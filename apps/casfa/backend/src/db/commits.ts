/**
 * CAS Stack - Database Operations for Commits
 *
 * Commits are user-visible top-level management units that track
 * the root nodes uploaded to a realm.
 *
 * Uses CasRealmTable with key prefix "COMMIT#" to distinguish from ownership records.
 * Key structure: realm (HASH) + "COMMIT#${root}" (RANGE)
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
import type { ICommitsDb } from "./memory/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Prefix for commit keys in CasRealmTable */
const COMMIT_KEY_PREFIX = "COMMIT#";

// ============================================================================
// Types
// ============================================================================

/**
 * Commit record - tracks a commit (upload) to a realm
 *
 * Stored in CasRealmTable with:
 * - realm: partition key (same as ownership)
 * - key: sort key with "COMMIT#" prefix
 */
export interface CommitRecord {
  /** Partition key: realm ID (e.g., "usr_xxx") */
  realm: string;
  /** Sort key: "COMMIT#${root}" (e.g., "COMMIT#sha256:abc...") */
  key: string;
  /** Root node key (the top-level file or collection) */
  root: string;
  /** Optional user-visible title */
  title?: string;
  /** Creation timestamp */
  createdAt: number;
  /** Token ID that created this commit */
  createdBy: string;
}

/**
 * Options for listing commits
 */
export interface ListCommitsOptions {
  limit?: number;
  startKey?: string;
}

/**
 * Result of listing commits
 */
export interface ListCommitsResult {
  commits: CommitRecord[];
  nextKey?: string;
}

// ============================================================================
// CommitsDb
// ============================================================================

export class CommitsDb implements ICommitsDb {
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

  /**
   * Build the sort key for a commit record
   */
  private buildKey(root: string): string {
    return `${COMMIT_KEY_PREFIX}${root}`;
  }

  /**
   * Create a new commit record
   */
  async create(
    realm: string,
    root: string,
    createdBy: string,
    title?: string
  ): Promise<CommitRecord> {
    const now = Date.now();
    const commit: CommitRecord = {
      realm,
      key: this.buildKey(root),
      root,
      title,
      createdAt: now,
      createdBy,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: commit,
      })
    );

    return commit;
  }

  /**
   * Get a commit by realm and root key
   */
  async get(realm: string, root: string): Promise<CommitRecord | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { realm, key: this.buildKey(root) },
      })
    );

    return (result.Item as CommitRecord) ?? null;
  }

  /**
   * List commits for a realm, ordered by key (which includes root hash)
   *
   * Uses Query with begins_with on the sort key to find all COMMIT# entries.
   */
  async list(realm: string, options: ListCommitsOptions = {}): Promise<ListCommitsResult> {
    const { limit = 100, startKey } = options;

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "#realm = :realm AND begins_with(#key, :prefix)",
        ExpressionAttributeNames: {
          "#realm": "realm",
          "#key": "key",
        },
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": COMMIT_KEY_PREFIX,
        },
        Limit: limit,
        ScanIndexForward: false, // Descending order by key
        ExclusiveStartKey: startKey ? { realm, key: startKey } : undefined,
      })
    );

    const commits = (result.Items ?? []) as CommitRecord[];

    // Sort by createdAt descending (newest first) since key order isn't time-based
    commits.sort((a, b) => b.createdAt - a.createdAt);

    return {
      commits,
      nextKey: result.LastEvaluatedKey?.key as string | undefined,
    };
  }

  /**
   * List commits using scan - fallback method for compatibility
   * This is equivalent to list() but named for API compatibility with MemoryCommitsDb
   */
  async listByScan(realm: string, options: ListCommitsOptions = {}): Promise<ListCommitsResult> {
    return this.list(realm, options);
  }

  /**
   * Update commit metadata (e.g., title)
   */
  async update(
    realm: string,
    root: string,
    updates: { title?: string }
  ): Promise<CommitRecord | null> {
    // Build update expression dynamically
    const updateParts: string[] = [];
    const expressionValues: Record<string, unknown> = {};
    const expressionNames: Record<string, string> = { "#key": "key" };

    if (updates.title !== undefined) {
      updateParts.push("#title = :title");
      expressionNames["#title"] = "title";
      expressionValues[":title"] = updates.title;
    }

    if (updateParts.length === 0) {
      // Nothing to update, just return current
      return this.get(realm, root);
    }

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { realm, key: this.buildKey(root) },
          UpdateExpression: `SET ${updateParts.join(", ")}`,
          ExpressionAttributeNames: expressionNames,
          ExpressionAttributeValues: expressionValues,
          ReturnValues: "ALL_NEW",
          ConditionExpression: "attribute_exists(#key)",
        })
      );

      return (result.Attributes as CommitRecord) ?? null;
    } catch (error: any) {
      if (error.name === "ConditionalCheckFailedException") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update commit title (convenience method)
   */
  async updateTitle(realm: string, root: string, title?: string): Promise<boolean> {
    const result = await this.update(realm, root, { title });
    return result !== null;
  }

  /**
   * Delete a commit record
   * Note: This only deletes the commit metadata, not the actual nodes
   */
  async delete(realm: string, root: string): Promise<boolean> {
    try {
      await this.client.send(
        new DeleteCommand({
          TableName: this.tableName,
          Key: { realm, key: this.buildKey(root) },
          ConditionExpression: "attribute_exists(#key)",
          ExpressionAttributeNames: { "#key": "key" },
        })
      );
      return true;
    } catch (error: any) {
      if (error.name === "ConditionalCheckFailedException") {
        return false;
      }
      throw error;
    }
  }

  /**
   * Check if a commit exists
   */
  async exists(realm: string, root: string): Promise<boolean> {
    const commit = await this.get(realm, root);
    return commit !== null;
  }
}
