/**
 * Commit database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { Commit } from "../types.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type CommitsDb = {
  create: (realm: string, root: string, createdBy: string, title?: string) => Promise<Commit>;
  get: (realm: string, root: string) => Promise<Commit | null>;
  update: (realm: string, root: string, updates: { title?: string }) => Promise<Commit | null>;
  delete: (realm: string, root: string) => Promise<boolean>;
  list: (
    realm: string,
    options?: { limit?: number; startKey?: string }
  ) => Promise<{
    commits: Commit[];
    nextKey?: string;
  }>;
};

type CommitsDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createCommitsDb = (config: CommitsDbConfig): CommitsDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const toSk = (root: string) => `COMMIT#${root}`;
  const fromSk = (sk: string) => sk.slice(7); // Remove "COMMIT#"

  const create = async (
    realm: string,
    root: string,
    createdBy: string,
    title?: string
  ): Promise<Commit> => {
    const now = Date.now();
    const commit: Commit = {
      realm,
      root,
      title,
      createdAt: now,
      createdBy,
    };

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: realm,
          sk: toSk(root),
          ...commit,
        },
      })
    );

    return commit;
  };

  const get = async (realm: string, root: string): Promise<Commit | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: realm, sk: toSk(root) },
      })
    );

    if (!result.Item) return null;

    return {
      realm: result.Item.pk,
      root: fromSk(result.Item.sk),
      title: result.Item.title,
      createdAt: result.Item.createdAt,
      createdBy: result.Item.createdBy,
    };
  };

  const update = async (
    realm: string,
    root: string,
    updates: { title?: string }
  ): Promise<Commit | null> => {
    try {
      const result = await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: realm, sk: toSk(root) },
          UpdateExpression: "SET title = :title",
          ExpressionAttributeValues: { ":title": updates.title },
          ConditionExpression: "attribute_exists(pk)",
          ReturnValues: "ALL_NEW",
        })
      );

      if (!result.Attributes) return null;

      return {
        realm: result.Attributes.pk,
        root: fromSk(result.Attributes.sk),
        title: result.Attributes.title,
        createdAt: result.Attributes.createdAt,
        createdBy: result.Attributes.createdBy,
      };
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return null;
      throw error;
    }
  };

  const deleteCommit = async (realm: string, root: string): Promise<boolean> => {
    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: realm, sk: toSk(root) },
          ConditionExpression: "attribute_exists(pk)",
        })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  };

  const list = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ commits: Commit[]; nextKey?: string }> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :realm AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": "COMMIT#",
        },
        Limit: options.limit ?? 100,
        ScanIndexForward: false, // newest first
        ExclusiveStartKey: options.startKey ? { pk: realm, sk: toSk(options.startKey) } : undefined,
      })
    );

    const commits = (result.Items ?? []).map((item) => ({
      realm: item.pk,
      root: fromSk(item.sk),
      title: item.title,
      createdAt: item.createdAt,
      createdBy: item.createdBy,
    }));

    const nextKey = result.LastEvaluatedKey ? fromSk(result.LastEvaluatedKey.sk) : undefined;

    return { commits, nextKey };
  };

  return {
    create,
    get,
    update,
    delete: deleteCommit,
    list,
  };
};
