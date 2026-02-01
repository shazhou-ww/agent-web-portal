/**
 * CAS Stack - Reference Count Database
 *
 * Tracks direct references from realm to CAS keys.
 * Used for GC and usage statistics.
 */

import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CasConfig, RefCount, GcStatus } from "../types.ts";
import { createDynamoDBClient } from "./client.ts";

/**
 * Options for listing pending GC nodes
 */
export interface ListPendingGCOptions {
  /** Only include nodes created before this timestamp */
  beforeTime: number;
  /** Max number of items to return */
  limit?: number;
  /** Start key for pagination (pk#sk format) */
  startKey?: string;
}

/**
 * Result of incrementRef operation
 */
export interface IncrementRefResult {
  /** Whether this is the first reference from this realm to this key */
  isNewToRealm: boolean;
  /** Current reference count after increment */
  count: number;
}

/**
 * Result of decrementRef operation
 */
export interface DecrementRefResult {
  /** Whether the reference was removed (count reached 0) */
  isRemoved: boolean;
  /** Current reference count after decrement */
  count: number;
}

export class RefCountDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    this.tableName = config.refCountTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(createDynamoDBClient(), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /**
   * Build partition key for refcount table
   */
  private buildPk(realm: string): string {
    return `ref#${realm}`;
  }

  /**
   * Increment reference count for a key in a realm
   *
   * If this is the first reference, creates the record with count=1
   * Otherwise, atomically increments the count
   */
  async incrementRef(
    realm: string,
    key: string,
    physicalSize: number,
    logicalSize: number
  ): Promise<IncrementRefResult> {
    const pk = this.buildPk(realm);
    const now = Date.now();

    try {
      // Use UpdateItem with conditional expression to handle both create and update
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: key },
          UpdateExpression: `
            SET #count = if_not_exists(#count, :zero) + :one,
                #physicalSize = if_not_exists(#physicalSize, :physicalSize),
                #logicalSize = if_not_exists(#logicalSize, :logicalSize),
                #createdAt = if_not_exists(#createdAt, :now),
                #gcStatus = :active
          `,
          ExpressionAttributeNames: {
            "#count": "count",
            "#physicalSize": "physicalSize",
            "#logicalSize": "logicalSize",
            "#createdAt": "createdAt",
            "#gcStatus": "gcStatus",
          },
          ExpressionAttributeValues: {
            ":zero": 0,
            ":one": 1,
            ":physicalSize": physicalSize,
            ":logicalSize": logicalSize,
            ":now": now,
            ":active": "active" as GcStatus,
          },
          ReturnValues: "ALL_NEW",
        })
      );

      const newCount = result.Attributes?.count as number;
      return {
        isNewToRealm: newCount === 1,
        count: newCount,
      };
    } catch (error) {
      throw new Error(`Failed to increment ref for ${realm}/${key}: ${error}`);
    }
  }

  /**
   * Decrement reference count for a key in a realm
   *
   * If count reaches 0, sets gcStatus to "pending" for GC
   */
  async decrementRef(realm: string, key: string): Promise<DecrementRefResult> {
    const pk = this.buildPk(realm);

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { pk, sk: key },
          UpdateExpression: `
            SET #count = #count - :one,
                #gcStatus = if(#count <= :one, :pending, #gcStatus)
          `,
          ConditionExpression: "attribute_exists(#count) AND #count > :zero",
          ExpressionAttributeNames: {
            "#count": "count",
            "#gcStatus": "gcStatus",
          },
          ExpressionAttributeValues: {
            ":zero": 0,
            ":one": 1,
            ":pending": "pending" as GcStatus,
          },
          ReturnValues: "ALL_NEW",
        })
      );

      const newCount = result.Attributes?.count as number;
      return {
        isRemoved: newCount === 0,
        count: newCount,
      };
    } catch (error: any) {
      // If condition check fails, the ref doesn't exist or is already 0
      if (error.name === "ConditionalCheckFailedException") {
        return { isRemoved: false, count: 0 };
      }
      throw new Error(`Failed to decrement ref for ${realm}/${key}: ${error}`);
    }
  }

  /**
   * Get reference count record
   */
  async getRefCount(realm: string, key: string): Promise<RefCount | null> {
    const pk = this.buildPk(realm);

    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: key },
      })
    );

    if (!result.Item) {
      return null;
    }

    return {
      realm,
      key,
      count: result.Item.count as number,
      physicalSize: result.Item.physicalSize as number,
      logicalSize: result.Item.logicalSize as number,
      gcStatus: result.Item.gcStatus as GcStatus,
      createdAt: result.Item.createdAt as number,
    };
  }

  /**
   * List nodes pending GC (count=0, past protection period)
   *
   * Uses GSI by-gc-status to efficiently query pending nodes
   */
  async listPendingGC(
    options: ListPendingGCOptions
  ): Promise<{ items: RefCount[]; nextKey?: string }> {
    const { beforeTime, limit = 100, startKey } = options;

    // Parse startKey if provided (format: "createdAt#pk/sk")
    let exclusiveStartKey: Record<string, any> | undefined;
    if (startKey) {
      const hashIndex = startKey.indexOf("#");
      if (hashIndex > 0) {
        const createdAtPart = startKey.substring(0, hashIndex);
        const rest = startKey.substring(hashIndex + 1);
        const slashIndex = rest.indexOf("/");
        if (slashIndex > 0) {
          const pkPart = rest.substring(0, slashIndex);
          const skPart = rest.substring(slashIndex + 1);
          exclusiveStartKey = {
            gcStatus: "pending" as GcStatus,
            createdAt: parseInt(createdAtPart, 10),
            pk: pkPart,
            sk: skPart,
          };
        }
      }
    }

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "by-gc-status",
        KeyConditionExpression: "#gcStatus = :pending AND #createdAt < :beforeTime",
        ExpressionAttributeNames: {
          "#gcStatus": "gcStatus",
          "#createdAt": "createdAt",
        },
        ExpressionAttributeValues: {
          ":pending": "pending" as GcStatus,
          ":beforeTime": beforeTime,
        },
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })
    );

    const items: RefCount[] = (result.Items ?? []).map((item) => {
      // Extract realm from pk (format: "ref#realm")
      const realm = (item.pk as string).substring(4);
      return {
        realm,
        key: item.sk as string,
        count: item.count as number,
        physicalSize: item.physicalSize as number,
        logicalSize: item.logicalSize as number,
        gcStatus: item.gcStatus as GcStatus,
        createdAt: item.createdAt as number,
      };
    });

    // Build next key for pagination
    let nextKey: string | undefined;
    if (result.LastEvaluatedKey) {
      const lastCreatedAt = result.LastEvaluatedKey.createdAt;
      const lastPk = result.LastEvaluatedKey.pk;
      const lastSk = result.LastEvaluatedKey.sk;
      nextKey = `${lastCreatedAt}#${lastPk}/${lastSk}`;
    }

    return { items, nextKey };
  }

  /**
   * Delete a reference count record
   */
  async deleteRefCount(realm: string, key: string): Promise<void> {
    const pk = this.buildPk(realm);

    await this.client.send(
      new DeleteCommand({
        TableName: this.tableName,
        Key: { pk, sk: key },
      })
    );
  }

  /**
   * Count total references to a key across all realms
   *
   * Used to determine if S3 blob can be deleted (global ref count = 0)
   */
  async countGlobalRefs(key: string): Promise<number> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "by-key",
        KeyConditionExpression: "#sk = :key",
        FilterExpression: "#count > :zero",
        ExpressionAttributeNames: {
          "#sk": "sk",
          "#count": "count",
        },
        ExpressionAttributeValues: {
          ":key": key,
          ":zero": 0,
        },
        Select: "COUNT",
      })
    );

    return result.Count ?? 0;
  }

  /**
   * List all references for a realm (for debugging/admin)
   */
  async listRealmRefs(
    realm: string,
    limit: number = 100,
    startKey?: string
  ): Promise<{ items: RefCount[]; nextKey?: string }> {
    const pk = this.buildPk(realm);

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: "#pk = :pk",
        ExpressionAttributeNames: {
          "#pk": "pk",
        },
        ExpressionAttributeValues: {
          ":pk": pk,
        },
        Limit: limit,
        ExclusiveStartKey: startKey ? { pk, sk: startKey } : undefined,
      })
    );

    const items: RefCount[] = (result.Items ?? []).map((item) => ({
      realm,
      key: item.sk as string,
      count: item.count as number,
      physicalSize: item.physicalSize as number,
      logicalSize: item.logicalSize as number,
      gcStatus: item.gcStatus as GcStatus,
      createdAt: item.createdAt as number,
    }));

    const nextKey = result.LastEvaluatedKey?.sk as string | undefined;

    return { items, nextKey };
  }
}
