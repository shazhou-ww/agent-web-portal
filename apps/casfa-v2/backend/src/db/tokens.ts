/**
 * Token database operations
 */

import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { loadServerConfig } from "../config.ts";
import type { AgentToken, CommitConfig, Ticket, Token, UserToken } from "../types.ts";
import {
  extractTokenId,
  generateAgentTokenId,
  generateTicketId,
  toTokenPk,
} from "../util/token-id.ts";
import { createDocClient } from "./client.ts";

// ============================================================================
// Types
// ============================================================================

export type TokensDb = {
  getToken: (tokenId: string) => Promise<Token | null>;
  getTicket: (ticketId: string) => Promise<Ticket | null>;
  createUserToken: (userId: string, refreshToken: string, expiresIn?: number) => Promise<UserToken>;
  createAgentToken: (
    userId: string,
    name: string,
    options?: { description?: string; expiresIn?: number }
  ) => Promise<AgentToken>;
  createTicket: (
    realm: string,
    issuerId: string,
    options?: {
      scope?: string[];
      commit?: { quota?: number; accept?: string[] };
      expiresIn?: number;
      issuerFingerprint?: string;
    }
  ) => Promise<Ticket>;
  markTicketCommitted: (ticketId: string, root: string) => Promise<boolean>;
  revokeAgentToken: (userId: string, tokenId: string) => Promise<void>;
  /**
   * Revoke a ticket with permission check.
   * - User Token (agentFingerprint undefined): can revoke any ticket in their realm
   * - Agent Token / AWP Client: can only revoke tickets they issued (matching fingerprint)
   */
  revokeTicket: (realm: string, ticketId: string, agentFingerprint?: string) => Promise<void>;
  deleteToken: (tokenId: string) => Promise<void>;
  listAgentTokensByUser: (userId: string) => Promise<AgentToken[]>;
};

type TokensDbConfig = {
  tableName: string;
  client?: DynamoDBDocumentClient;
};

// ============================================================================
// Factory
// ============================================================================

export const createTokensDb = (config: TokensDbConfig): TokensDb => {
  const client = config.client ?? createDocClient();
  const tableName = config.tableName;

  const generateUserTokenId = (): string => {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substring(2, 10);
    return `usr_${timestamp}${random}`;
  };

  const getToken = async (tokenId: string): Promise<Token | null> => {
    const result = await client.send(
      new GetCommand({
        TableName: tableName,
        Key: { pk: toTokenPk(tokenId), sk: "TOKEN" },
      })
    );

    if (!result.Item) return null;
    if (result.Item.expiresAt && result.Item.expiresAt < Date.now()) return null;

    return result.Item as Token;
  };

  const getTicket = async (ticketId: string): Promise<Ticket | null> => {
    const token = await getToken(ticketId);
    if (!token || token.type !== "ticket") return null;
    return token as Ticket;
  };

  const createUserToken = async (
    userId: string,
    refreshToken: string,
    expiresIn = 3600
  ): Promise<UserToken> => {
    const tokenId = generateUserTokenId();
    const now = Date.now();
    const expiresAt = now + expiresIn * 1000;

    const token: UserToken = {
      pk: toTokenPk(tokenId),
      sk: "TOKEN",
      type: "user",
      userId,
      refreshToken,
      createdAt: now,
      expiresAt,
    };

    await client.send(new PutCommand({ TableName: tableName, Item: token }));
    return token;
  };

  const createAgentToken = async (
    userId: string,
    name: string,
    options: { description?: string; expiresIn?: number } = {}
  ): Promise<AgentToken> => {
    const serverConfig = loadServerConfig();
    const tokenId = generateAgentTokenId();
    const now = Date.now();
    const expiresIn = options.expiresIn ?? 2592000; // 30 days default
    const cappedExpiresIn = Math.min(expiresIn, serverConfig.maxAgentTokenTtl);
    const expiresAt = now + cappedExpiresIn * 1000;

    const token: AgentToken = {
      pk: toTokenPk(tokenId),
      sk: "TOKEN",
      type: "agent",
      userId,
      name,
      description: options.description,
      createdAt: now,
      expiresAt,
    };

    await client.send(new PutCommand({ TableName: tableName, Item: token }));
    return token;
  };

  const createTicket = async (
    realm: string,
    issuerId: string,
    options?: {
      scope?: string[];
      commit?: { quota?: number; accept?: string[] };
      expiresIn?: number;
      issuerFingerprint?: string;
    }
  ): Promise<Ticket> => {
    const { scope, commit, expiresIn, issuerFingerprint } = options ?? {};
    const serverConfig = loadServerConfig();
    const ticketId = generateTicketId();
    const now = Date.now();
    const requestedExpiresIn = expiresIn ?? 3600;
    const cappedExpiresIn = Math.min(requestedExpiresIn, serverConfig.maxTicketTtl);
    const expiresAt = now + cappedExpiresIn * 1000;

    const ticket: Ticket = {
      pk: toTokenPk(ticketId),
      sk: "TOKEN",
      type: "ticket",
      realm,
      issuerId,
      issuerFingerprint,
      scope,
      commit,
      createdAt: now,
      expiresAt,
      config: {
        nodeLimit: serverConfig.nodeLimit,
        maxNameBytes: serverConfig.maxNameBytes,
      },
    };

    await client.send(new PutCommand({ TableName: tableName, Item: ticket }));
    return ticket;
  };

  const markTicketCommitted = async (ticketId: string, root: string): Promise<boolean> => {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { pk: toTokenPk(ticketId), sk: "TOKEN" },
          UpdateExpression: "SET #commit.#root = :root",
          ConditionExpression: "attribute_not_exists(#commit.#root)",
          ExpressionAttributeNames: {
            "#commit": "commit",
            "#root": "root",
          },
          ExpressionAttributeValues: { ":root": root },
        })
      );
      return true;
    } catch (error: unknown) {
      const err = error as { name?: string };
      if (err.name === "ConditionalCheckFailedException") return false;
      throw error;
    }
  };

  const revokeAgentToken = async (userId: string, tokenId: string): Promise<void> => {
    const token = await getToken(tokenId);
    if (!token || token.type !== "agent" || (token as AgentToken).userId !== userId) {
      throw new Error("Token not found or access denied");
    }
    await client.send(new DeleteCommand({ TableName: tableName, Key: { pk: toTokenPk(tokenId), sk: "TOKEN" } }));
  };

  const listAgentTokensByUser = async (userId: string): Promise<AgentToken[]> => {
    const result = await client.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: "userId-index",
        KeyConditionExpression: "userId = :userId",
        FilterExpression: "#type = :type AND expiresAt > :now",
        ExpressionAttributeNames: { "#type": "type" },
        ExpressionAttributeValues: {
          ":userId": userId,
          ":type": "agent",
          ":now": Date.now(),
        },
      })
    );
    return (result.Items ?? []) as AgentToken[];
  };

  const deleteToken = async (tokenId: string): Promise<void> => {
    await client.send(new DeleteCommand({ TableName: tableName, Key: { pk: toTokenPk(tokenId), sk: "TOKEN" } }));
  };

  const revokeTicket = async (
    realm: string,
    ticketId: string,
    agentFingerprint?: string
  ): Promise<void> => {
    const ticket = await getTicket(ticketId);
    if (!ticket) {
      throw new Error("Ticket not found");
    }

    // Verify the ticket belongs to this realm
    if (ticket.realm !== realm) {
      throw new Error("Ticket not found or access denied");
    }

    // Permission check:
    // - User Token (agentFingerprint undefined): can revoke any ticket in their realm
    // - Agent Token / AWP Client: can only revoke tickets they issued (matching fingerprint)
    if (agentFingerprint !== undefined) {
      if (ticket.issuerFingerprint !== agentFingerprint) {
        throw new Error("Access denied: can only revoke tickets you issued");
      }
    }

    await deleteToken(ticketId);
  };

  return {
    getToken,
    getTicket,
    createUserToken,
    createAgentToken,
    createTicket,
    markTicketCommitted,
    revokeAgentToken,
    revokeTicket,
    deleteToken,
    listAgentTokensByUser,
  };
};
