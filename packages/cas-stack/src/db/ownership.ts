/**
 * CAS Stack - Database Operations for CAS Ownership
 */

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  BatchGetCommand,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CasConfig, CasOwnership } from "../types.ts";

export class OwnershipDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    this.tableName = config.casOwnershipTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(new DynamoDBClient({}), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /**
   * Check if a shard owns a specific key
   */
  async hasOwnership(shard: string, key: string): Promise<boolean> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { shard, key },
      })
    );

    return !!result.Item;
  }

  /**
   * Get ownership record
   */
  async getOwnership(shard: string, key: string): Promise<CasOwnership | null> {
    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { shard, key },
      })
    );

    return (result.Item as CasOwnership) ?? null;
  }

  /**
   * Check which keys a shard owns from a list
   */
  async checkOwnership(
    shard: string,
    keys: string[]
  ): Promise<{ found: string[]; missing: string[] }> {
    if (keys.length === 0) {
      return { found: [], missing: [] };
    }

    // DynamoDB BatchGet has a limit of 100 items
    const batchSize = 100;
    const found: string[] = [];

    for (let i = 0; i < keys.length; i += batchSize) {
      const batch = keys.slice(i, i + batchSize);
      const batchKeys = batch.map((key) => ({ shard, key }));

      const result = await this.client.send(
        new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: batchKeys,
            },
          },
        })
      );

      const items = result.Responses?.[this.tableName] ?? [];
      for (const item of items) {
        found.push(item.key as string);
      }
    }

    const foundSet = new Set(found);
    const missing = keys.filter((key) => !foundSet.has(key));

    return { found, missing };
  }

  /**
   * Add ownership record
   */
  async addOwnership(
    shard: string,
    key: string,
    createdBy: string,
    contentType: string,
    size: number
  ): Promise<CasOwnership> {
    const ownership: CasOwnership = {
      shard,
      key,
      createdAt: Date.now(),
      createdBy,
      contentType,
      size,
    };

    await this.client.send(
      new PutCommand({
        TableName: this.tableName,
        Item: ownership,
      })
    );

    return ownership;
  }

  /**
   * Remove ownership record
   */
  async removeOwnership(shard: string, key: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { shard, key },
      })
    );
  }

  /**
   * List all keys owned by a shard (with pagination)
   */
  async listKeys(
    shard: string,
    limit: number = 100,
    startKey?: string
  ): Promise<{ keys: string[]; nextKey?: string }> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "shard = :shard",
        ExpressionAttributeValues: {
          ":shard": shard,
        },
        Limit: limit,
        ExclusiveStartKey: startKey ? { shard, key: startKey } : undefined,
      })
    );

    const keys = (result.Items ?? []).map((item) => item.key as string);
    const nextKey = result.LastEvaluatedKey?.key as string | undefined;

    return { keys, nextKey };
  }

  /**
   * List all ownership records for a shard (with pagination)
   */
  async listOwnership(
    shard: string,
    limit: number = 100,
    startKey?: string
  ): Promise<{ nodes: CasOwnership[]; nextKey?: string; total?: number }> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "shard = :shard",
        ExpressionAttributeValues: {
          ":shard": shard,
        },
        Limit: limit,
        ExclusiveStartKey: startKey ? { shard, key: startKey } : undefined,
      })
    );

    const nodes = (result.Items ?? []) as CasOwnership[];
    const nextKey = result.LastEvaluatedKey?.key as string | undefined;

    return { nodes, nextKey };
  }

  /**
   * Count how many shards reference a key (for GC)
   */
  async countReferences(key: string): Promise<number> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "by-key",
        KeyConditionExpression: "#key = :key",
        ExpressionAttributeNames: {
          "#key": "key",
        },
        ExpressionAttributeValues: {
          ":key": key,
        },
        Select: "COUNT",
      })
    );

    return result.Count ?? 0;
  }
}
