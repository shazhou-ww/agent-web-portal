/**
 * CAS Stack - Realm Usage Database
 *
 * Tracks aggregated storage usage per realm.
 * Used for quota enforcement and usage statistics.
 */

import {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { CasConfig, RealmUsage } from "../types.ts";
import { createDynamoDBClient } from "./client.ts";

/**
 * Delta for updating realm usage
 */
export interface UsageDelta {
  physicalBytes?: number;
  logicalBytes?: number;
  nodeCount?: number;
}

export class UsageDb {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(config: CasConfig, client?: DynamoDBDocumentClient) {
    this.tableName = config.usageTable;
    this.client =
      client ??
      DynamoDBDocumentClient.from(createDynamoDBClient(), {
        marshallOptions: { removeUndefinedValues: true },
      });
  }

  /**
   * Build partition key for usage table
   */
  private buildPk(realm: string): string {
    return `usage#${realm}`;
  }

  /**
   * Get current usage for a realm
   */
  async getUsage(realm: string): Promise<RealmUsage> {
    const pk = this.buildPk(realm);

    const result = await this.client.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk, sk: "SUMMARY" },
      })
    );

    if (!result.Item) {
      // Return default values if no usage record exists
      return {
        realm,
        physicalBytes: 0,
        logicalBytes: 0,
        nodeCount: 0,
        quotaLimit: 0,
        updatedAt: 0,
      };
    }

    return {
      realm,
      physicalBytes: (result.Item.physicalBytes as number) ?? 0,
      logicalBytes: (result.Item.logicalBytes as number) ?? 0,
      nodeCount: (result.Item.nodeCount as number) ?? 0,
      quotaLimit: (result.Item.quotaLimit as number) ?? 0,
      updatedAt: (result.Item.updatedAt as number) ?? 0,
    };
  }

  /**
   * Update usage for a realm (atomic increment/decrement)
   *
   * @param realm - Realm to update
   * @param delta - Changes to apply (can be positive or negative)
   * @returns Updated usage values
   */
  async updateUsage(realm: string, delta: UsageDelta): Promise<RealmUsage> {
    const pk = this.buildPk(realm);
    const now = Date.now();

    // Build update expression dynamically
    const updateParts: string[] = ["#updatedAt = :now"];
    const names: Record<string, string> = { "#updatedAt": "updatedAt" };
    const values: Record<string, any> = { ":now": now, ":zero": 0 };

    if (delta.physicalBytes !== undefined && delta.physicalBytes !== 0) {
      updateParts.push("#physicalBytes = if_not_exists(#physicalBytes, :zero) + :physicalDelta");
      names["#physicalBytes"] = "physicalBytes";
      values[":physicalDelta"] = delta.physicalBytes;
    }

    if (delta.logicalBytes !== undefined && delta.logicalBytes !== 0) {
      updateParts.push("#logicalBytes = if_not_exists(#logicalBytes, :zero) + :logicalDelta");
      names["#logicalBytes"] = "logicalBytes";
      values[":logicalDelta"] = delta.logicalBytes;
    }

    if (delta.nodeCount !== undefined && delta.nodeCount !== 0) {
      updateParts.push("#nodeCount = if_not_exists(#nodeCount, :zero) + :nodeDelta");
      names["#nodeCount"] = "nodeCount";
      values[":nodeDelta"] = delta.nodeCount;
    }

    const result = await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: "SUMMARY" },
        UpdateExpression: `SET ${updateParts.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      })
    );

    return {
      realm,
      physicalBytes: (result.Attributes?.physicalBytes as number) ?? 0,
      logicalBytes: (result.Attributes?.logicalBytes as number) ?? 0,
      nodeCount: (result.Attributes?.nodeCount as number) ?? 0,
      quotaLimit: (result.Attributes?.quotaLimit as number) ?? 0,
      updatedAt: (result.Attributes?.updatedAt as number) ?? now,
    };
  }

  /**
   * Set quota limit for a realm
   *
   * @param realm - Realm to update
   * @param quotaLimit - New quota limit in bytes (0 = unlimited)
   */
  async setQuotaLimit(realm: string, quotaLimit: number): Promise<void> {
    const pk = this.buildPk(realm);
    const now = Date.now();

    await this.client.send(
      new UpdateCommand({
        TableName: this.tableName,
        Key: { pk, sk: "SUMMARY" },
        UpdateExpression: `
          SET #quotaLimit = :quotaLimit,
              #updatedAt = :now,
              #physicalBytes = if_not_exists(#physicalBytes, :zero),
              #logicalBytes = if_not_exists(#logicalBytes, :zero),
              #nodeCount = if_not_exists(#nodeCount, :zero)
        `,
        ExpressionAttributeNames: {
          "#quotaLimit": "quotaLimit",
          "#updatedAt": "updatedAt",
          "#physicalBytes": "physicalBytes",
          "#logicalBytes": "logicalBytes",
          "#nodeCount": "nodeCount",
        },
        ExpressionAttributeValues: {
          ":quotaLimit": quotaLimit,
          ":now": now,
          ":zero": 0,
        },
      })
    );
  }

  /**
   * Check if adding bytes would exceed quota
   *
   * @param realm - Realm to check
   * @param additionalBytes - Bytes to be added
   * @returns { allowed: boolean, usage: RealmUsage }
   */
  async checkQuota(
    realm: string,
    additionalBytes: number
  ): Promise<{ allowed: boolean; usage: RealmUsage }> {
    const usage = await this.getUsage(realm);

    // If quotaLimit is 0, no limit is enforced
    if (usage.quotaLimit === 0) {
      return { allowed: true, usage };
    }

    const allowed = usage.physicalBytes + additionalBytes <= usage.quotaLimit;
    return { allowed, usage };
  }
}
