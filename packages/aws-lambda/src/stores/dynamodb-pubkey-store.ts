/**
 * DynamoDB implementation of PubkeyStore
 *
 * Stores authorized pubkey records with optional TTL.
 */

import type { AuthorizedPubkey, PubkeyStore } from "@agent-web-portal/auth";
import {
  type AttributeValue,
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
  QueryCommand,
} from "@aws-sdk/client-dynamodb";

/**
 * Options for DynamoDB pubkey store
 */
export interface DynamoDBPubkeyStoreOptions {
  /** DynamoDB table name */
  tableName: string;
  /** AWS region (defaults to AWS_REGION env) */
  region?: string;
  /** Existing DynamoDB client (optional) */
  client?: DynamoDBClient;
  /** GSI name for user ID lookups (required for listByUser) */
  userIdIndexName?: string;
}

/**
 * DynamoDB implementation of PubkeyStore
 *
 * Table schema:
 * - pk (S): "PUBKEY#<pubkey>" - Partition key
 * - pubkey (S): The client's public key
 * - userId (S): Associated user ID
 * - clientName (S): Client name
 * - createdAt (N): Unix timestamp ms when authorized
 * - expiresAt (N): Unix timestamp ms when it expires (optional)
 * - ttl (N): Unix timestamp seconds for DynamoDB TTL (optional)
 *
 * GSI for user lookups (optional):
 * - userId (S): Partition key
 * - createdAt (N): Sort key
 *
 * Enable TTL on the `ttl` attribute for automatic cleanup.
 */
export class DynamoDBPubkeyStore implements PubkeyStore {
  private client: DynamoDBClient;
  private tableName: string;
  private userIdIndexName?: string;

  constructor(options: DynamoDBPubkeyStoreOptions) {
    this.tableName = options.tableName;
    this.userIdIndexName = options.userIdIndexName;
    this.client =
      options.client ??
      new DynamoDBClient({
        region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
      });
  }

  async lookup(pubkey: string): Promise<AuthorizedPubkey | null> {
    const pk = `PUBKEY#${pubkey}`;

    const result = await this.client.send(
      new GetItemCommand({
        TableName: this.tableName,
        Key: {
          pk: { S: pk },
        },
      })
    );

    if (!result.Item) {
      return null;
    }

    const item = result.Item;
    const expiresAt = item.expiresAt?.N ? parseInt(item.expiresAt.N, 10) : undefined;

    // Check if expired
    if (expiresAt && Date.now() > expiresAt) {
      // Clean up expired item
      await this.revoke(pubkey);
      return null;
    }

    return {
      pubkey: item.pubkey?.S ?? "",
      userId: item.userId?.S ?? "",
      clientName: item.clientName?.S ?? "",
      createdAt: parseInt(item.createdAt?.N ?? "0", 10),
      expiresAt,
    };
  }

  async store(auth: AuthorizedPubkey): Promise<void> {
    const pk = `PUBKEY#${auth.pubkey}`;

    const item: Record<string, AttributeValue> = {
      pk: { S: pk },
      pubkey: { S: auth.pubkey },
      userId: { S: auth.userId },
      clientName: { S: auth.clientName },
      createdAt: { N: auth.createdAt.toString() },
    };

    if (auth.expiresAt) {
      item.expiresAt = { N: auth.expiresAt.toString() };
      item.ttl = { N: Math.floor(auth.expiresAt / 1000).toString() };
    }

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: item,
      })
    );
  }

  async revoke(pubkey: string): Promise<void> {
    const pk = `PUBKEY#${pubkey}`;

    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: {
          pk: { S: pk },
        },
      })
    );
  }

  async listByUser(userId: string): Promise<AuthorizedPubkey[]> {
    if (!this.userIdIndexName) {
      throw new Error("userIdIndexName is required for listByUser");
    }

    const result = await this.client.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: this.userIdIndexName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": { S: userId },
        },
      })
    );

    if (!result.Items) {
      return [];
    }

    const now = Date.now();
    const results: AuthorizedPubkey[] = [];

    for (const item of result.Items) {
      const expiresAt = item.expiresAt?.N ? parseInt(item.expiresAt.N, 10) : undefined;

      // Skip expired items
      if (expiresAt && now > expiresAt) {
        continue;
      }

      results.push({
        pubkey: item.pubkey?.S ?? "",
        userId: item.userId?.S ?? "",
        clientName: item.clientName?.S ?? "",
        createdAt: parseInt(item.createdAt?.N ?? "0", 10),
        expiresAt,
      });
    }

    return results;
  }
}
