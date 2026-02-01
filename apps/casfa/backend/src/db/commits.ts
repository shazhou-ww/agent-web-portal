/**
 * CAS Stack - Database Operations for Commits
 *
 * Commits are user-visible top-level management units that track
 * the root nodes uploaded to a realm.
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
// Types
// ============================================================================

/**
 * Commit record - tracks a commit (upload) to a realm
 */
export interface CommitRecord {
  /** Primary key: REALM#{realm}#COMMIT#{root} */
  pk: string;
  /** Sort key for GSI queries: createdAt timestamp */
  sk: number;
  /** The realm this commit belongs to */
  realm: string;
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

export class CommitsDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    // Use the same table as ownership (cas-realm table)
    // Commits are stored with a different pk format
    this.tableName = config.casRealmTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(createDynamoDBClient(), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /**
   * Build primary key for commit record
   */
  private buildPk(realm: string, root: string): string {
    return `REALM#${realm}#COMMIT#${root}`;
  }

  /**
   * Parse realm and root from primary key
   */
  private parsePk(pk: string): { realm: string; root: string } | null {
    const match = pk.match(/^REALM#(.+)#COMMIT#(.+)$/);
    if (!match) return null;
    return { realm: match[1]!, root: match[2]! };
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
      pk: this.buildPk(realm, root),
      sk: now,
      realm,
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
        Key: { pk: this.buildPk(realm, root) },
      })
    );

    return (result.Item as CommitRecord) ?? null;
  }

  /**
   * List commits for a realm, ordered by creation time (newest first)
   *
   * Note: This uses a Scan with filter since we're using a composite pk.
   * For production scale, consider adding a GSI on (realm, createdAt).
   */
  async list(realm: string, options: ListCommitsOptions = {}): Promise<ListCommitsResult> {
    const { limit = 100, startKey } = options;

    // Query using pk prefix pattern
    // Since DynamoDB doesn't support prefix queries on pk directly,
    // we need to scan with a filter or use a GSI.
    // For now, we use a scan with filter for simplicity.
    // TODO: Add GSI (realm-createdAt-index) for better performance at scale.

    const pkPrefix = `REALM#${realm}#COMMIT#`;

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "begins_with(pk, :pkPrefix)",
        ExpressionAttributeValues: {
          ":pkPrefix": pkPrefix,
        },
        Limit: limit,
        ScanIndexForward: false, // newest first
        ExclusiveStartKey: startKey ? { pk: startKey } : undefined,
      })
    );

    const commits = (result.Items ?? []) as CommitRecord[];

    return {
      commits,
      nextKey: result.LastEvaluatedKey?.pk as string | undefined,
    };
  }

  /**
   * List commits for a realm using scan (fallback method)
   */
  async listByScan(realm: string, options: ListCommitsOptions = {}): Promise<ListCommitsResult> {
    const { limit = 100 } = options;

    const pkPrefix = `REALM#${realm}#COMMIT#`;

    // Use scan with filter expression
    const { ScanCommand } = await import("@aws-sdk/lib-dynamodb");

    const result = await this.client.send(
      new ScanCommand({
        TableName: this.tableName,
        FilterExpression: "begins_with(pk, :pkPrefix)",
        ExpressionAttributeValues: {
          ":pkPrefix": pkPrefix,
        },
        Limit: limit * 10, // Scan more to account for filtering
      })
    );

    // Sort by createdAt descending and limit
    const commits = ((result.Items ?? []) as CommitRecord[])
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);

    return {
      commits,
      nextKey: undefined, // Scan pagination is complex, skip for now
    };
  }

  /**
   * Update commit metadata (e.g., title)
   */
  async update(
    realm: string,
    root: string,
    updates: { title?: string }
  ): Promise<CommitRecord | null> {
    const pk = this.buildPk(realm, root);

    // Build update expression dynamically
    const updateParts: string[] = [];
    const expressionValues: Record<string, unknown> = {};

    if (updates.title !== undefined) {
      updateParts.push("title = :title");
      expressionValues[":title"] = updates.title;
    }

    if (updateParts.length === 0) {
      // Nothing to update, just return current
      return this.get(realm, root);
    }

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk },
        UpdateExpression: `SET ${updateParts.join(", ")}`,
        ExpressionAttributeValues: expressionValues,
        ReturnValues: "ALL_NEW",
        ConditionExpression: "attribute_exists(pk)",
      })
    );

    return (result.Attributes as CommitRecord) ?? null;
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
          Key: { pk: this.buildPk(realm, root) },
          ConditionExpression: "attribute_exists(pk)",
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
