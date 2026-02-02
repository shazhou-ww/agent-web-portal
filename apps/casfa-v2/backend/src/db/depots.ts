/**
 * Depot database operations
 */

import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb"
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb"
import type { Depot, DepotHistory } from "../types.ts"
import { createDocClient } from "./client.ts"
import { generateDepotId } from "../util/token-id.ts"

// ============================================================================
// Constants
// ============================================================================

export const MAIN_DEPOT_NAME = "main"

// ============================================================================
// Types
// ============================================================================

export type DepotsDb = {
  create: (realm: string, options: { name: string; root: string; description?: string }) => Promise<Depot>
  get: (realm: string, depotId: string) => Promise<Depot | null>
  getByName: (realm: string, name: string) => Promise<Depot | null>
  updateRoot: (realm: string, depotId: string, root: string, message?: string) => Promise<{ depot: Depot; history: DepotHistory }>
  delete: (realm: string, depotId: string) => Promise<boolean>
  list: (realm: string, options?: { limit?: number; startKey?: string }) => Promise<{ depots: Depot[]; nextKey?: string }>
  getHistory: (realm: string, depotId: string, version: number) => Promise<DepotHistory | null>
  listHistory: (realm: string, depotId: string, options?: { limit?: number; startKey?: string }) => Promise<{ history: DepotHistory[]; nextKey?: string }>
}

type DepotsDbConfig = {
  tableName: string
  client?: DynamoDBDocumentClient
}

// ============================================================================
// Factory
// ============================================================================

export const createDepotsDb = (config: DepotsDbConfig): DepotsDb => {
  const client = config.client ?? createDocClient()
  const tableName = config.tableName

  const toDepotSk = (depotId: string) => `DEPOT#${depotId}`
  const toHistorySk = (depotId: string, version: number) => `DEPOT_HIST#${depotId}#${String(version).padStart(10, "0")}`

  const create = async (
    realm: string,
    options: { name: string; root: string; description?: string }
  ): Promise<Depot> => {
    const depotId = generateDepotId()
    const now = Date.now()

    const depot: Depot = {
      realm,
      depotId,
      name: options.name,
      root: options.root,
      version: 1,
      createdAt: now,
      updatedAt: now,
      description: options.description,
    }

    // Create depot record
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: realm,
          sk: toDepotSk(depotId),
          gsi1pk: `${realm}#DEPOT_NAME`,
          gsi1sk: options.name,
          ...depot,
        },
      })
    )

    // Create initial history record
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: realm,
          sk: toHistorySk(depotId, 1),
          depotId,
          version: 1,
          root: options.root,
          createdAt: now,
          message: "Initial version",
        },
      })
    )

    return depot
  }

  const get = async (realm: string, depotId: string): Promise<Depot | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: realm, sk: toDepotSk(depotId) },
      })
    )
    if (!result.Item) return null
    return result.Item as Depot
  }

  const getByName = async (realm: string, name: string): Promise<Depot | null> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "gsi1",
        KeyConditionExpression: "gsi1pk = :pk AND gsi1sk = :sk",
        ExpressionAttributeValues: {
          ":pk": `${realm}#DEPOT_NAME`,
          ":sk": name,
        },
        Limit: 1,
      })
    )
    if (!result.Items || result.Items.length === 0) return null
    return result.Items[0] as Depot
  }

  const updateRoot = async (
    realm: string,
    depotId: string,
    root: string,
    message?: string
  ): Promise<{ depot: Depot; history: DepotHistory }> => {
    const now = Date.now()

    // Update depot with new version
    const updateResult = await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { pk: realm, sk: toDepotSk(depotId) },
        UpdateExpression: "SET #root = :root, #version = #version + :one, updatedAt = :now",
        ExpressionAttributeNames: {
          "#root": "root",
          "#version": "version",
        },
        ExpressionAttributeValues: {
          ":root": root,
          ":one": 1,
          ":now": now,
        },
        ReturnValues: "ALL_NEW",
      })
    )

    const depot = updateResult.Attributes as Depot

    // Create history record
    const historyRecord: DepotHistory = {
      realm,
      depotId,
      version: depot.version,
      root,
      createdAt: now,
      message,
    }

    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          pk: realm,
          sk: toHistorySk(depotId, depot.version),
          ...historyRecord,
        },
      })
    )

    return { depot, history: historyRecord }
  }

  const deleteDepot = async (realm: string, depotId: string): Promise<boolean> => {
    try {
      await client.send(
        new DeleteCommand({
          TableName: tableName,
          Key: { pk: realm, sk: toDepotSk(depotId) },
          ConditionExpression: "attribute_exists(pk)",
        })
      )
      return true
    } catch (error: unknown) {
      const err = error as { name?: string }
      if (err.name === "ConditionalCheckFailedException") return false
      throw error
    }
  }

  const list = async (
    realm: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ depots: Depot[]; nextKey?: string }> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :realm AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": "DEPOT#",
        },
        Limit: options.limit ?? 100,
        ExclusiveStartKey: options.startKey
          ? { pk: realm, sk: toDepotSk(options.startKey) }
          : undefined,
      })
    )

    const depots = (result.Items ?? []) as Depot[]
    const nextKey = result.LastEvaluatedKey?.sk?.slice(6) // Remove "DEPOT#"

    return { depots, nextKey }
  }

  const getHistory = async (
    realm: string,
    depotId: string,
    version: number
  ): Promise<DepotHistory | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: realm, sk: toHistorySk(depotId, version) },
      })
    )
    if (!result.Item) return null
    return result.Item as DepotHistory
  }

  const listHistory = async (
    realm: string,
    depotId: string,
    options: { limit?: number; startKey?: string } = {}
  ): Promise<{ history: DepotHistory[]; nextKey?: string }> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :realm AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":realm": realm,
          ":prefix": `DEPOT_HIST#${depotId}#`,
        },
        Limit: options.limit ?? 50,
        ScanIndexForward: false, // newest first
        ExclusiveStartKey: options.startKey
          ? { pk: realm, sk: options.startKey }
          : undefined,
      })
    )

    const history = (result.Items ?? []) as DepotHistory[]
    const nextKey = result.LastEvaluatedKey?.sk

    return { history, nextKey }
  }

  return {
    create,
    get,
    getByName,
    updateRoot,
    delete: deleteDepot,
    list,
    getHistory,
    listHistory,
  }
}
