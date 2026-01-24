/**
 * DynamoDB implementation of PendingAuthStore
 *
 * Stores pending authorization records with TTL for automatic cleanup.
 */

import type { PendingAuth, PendingAuthStore } from "@agent-web-portal/auth";
import {
  DeleteItemCommand,
  DynamoDBClient,
  GetItemCommand,
  PutItemCommand,
} from "@aws-sdk/client-dynamodb";

/**
 * Options for DynamoDB pending auth store
 */
export interface DynamoDBPendingAuthStoreOptions {
  /** DynamoDB table name */
  tableName: string;
  /** AWS region (defaults to AWS_REGION env) */
  region?: string;
  /** Existing DynamoDB client (optional) */
  client?: DynamoDBClient;
}

/**
 * DynamoDB implementation of PendingAuthStore
 *
 * Table schema:
 * - pk (S): "PENDING#<pubkey>" - Partition key
 * - pubkey (S): The client's public key
 * - clientName (S): Client name for display
 * - verificationCode (S): Server-generated verification code
 * - createdAt (N): Unix timestamp ms when created
 * - expiresAt (N): Unix timestamp ms when it expires
 * - ttl (N): Unix timestamp seconds for DynamoDB TTL
 *
 * Enable TTL on the `ttl` attribute for automatic cleanup.
 */
export class DynamoDBPendingAuthStore implements PendingAuthStore {
  private client: DynamoDBClient;
  private tableName: string;

  constructor(options: DynamoDBPendingAuthStoreOptions) {
    this.tableName = options.tableName;
    this.client =
      options.client ??
      new DynamoDBClient({
        region: options.region ?? process.env.AWS_REGION ?? "us-east-1",
      });
  }

  async create(auth: PendingAuth): Promise<void> {
    const pk = `PENDING#${auth.pubkey}`;
    const ttl = Math.floor(auth.expiresAt / 1000); // DynamoDB TTL uses seconds

    await this.client.send(
      new PutItemCommand({
        TableName: this.tableName,
        Item: {
          pk: { S: pk },
          pubkey: { S: auth.pubkey },
          clientName: { S: auth.clientName },
          verificationCode: { S: auth.verificationCode },
          createdAt: { N: auth.createdAt.toString() },
          expiresAt: { N: auth.expiresAt.toString() },
          ttl: { N: ttl.toString() },
        },
      })
    );
  }

  async get(pubkey: string): Promise<PendingAuth | null> {
    const pk = `PENDING#${pubkey}`;

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
    const expiresAt = parseInt(item.expiresAt?.N ?? "0", 10);

    // Check if expired
    if (Date.now() > expiresAt) {
      // Clean up expired item
      await this.delete(pubkey);
      return null;
    }

    return {
      pubkey: item.pubkey?.S ?? "",
      clientName: item.clientName?.S ?? "",
      verificationCode: item.verificationCode?.S ?? "",
      createdAt: parseInt(item.createdAt?.N ?? "0", 10),
      expiresAt,
    };
  }

  async delete(pubkey: string): Promise<void> {
    const pk = `PENDING#${pubkey}`;

    await this.client.send(
      new DeleteItemCommand({
        TableName: this.tableName,
        Key: {
          pk: { S: pk },
        },
      })
    );
  }

  async validateCode(pubkey: string, code: string): Promise<boolean> {
    const auth = await this.get(pubkey);
    if (!auth) {
      return false;
    }
    return auth.verificationCode === code;
  }
}
