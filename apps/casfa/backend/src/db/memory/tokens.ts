/**
 * Memory Tokens Storage
 *
 * In-memory implementation of TokensDb for local development.
 */

import type { CommitConfig, Ticket, Token, UserToken } from "../../types.ts";
import type { ITokensDb } from "./types.ts";

export interface ServerConfig {
  nodeLimit: number;
  maxNameBytes: number;
}

export class MemoryTokensDb implements ITokensDb {
  private tokens = new Map<string, Token>();
  private serverConfig: ServerConfig;

  constructor(serverConfig: ServerConfig) {
    this.serverConfig = serverConfig;
  }

  async getToken(tokenId: string): Promise<Token | null> {
    const token = this.tokens.get(`token#${tokenId}`);
    if (!token) return null;
    if (token.expiresAt < Date.now()) {
      this.tokens.delete(`token#${tokenId}`);
      return null;
    }
    return token;
  }

  async createUserToken(
    userId: string,
    refreshToken: string,
    expiresIn: number = 3600
  ): Promise<UserToken> {
    const tokenId = `usr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const token: UserToken = {
      pk: `token#${tokenId}`,
      type: "user",
      userId,
      refreshToken,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(token.pk, token);
    return token;
  }

  async createTicket(
    realm: string,
    issuerId: string,
    scope?: string | string[],
    commit?: boolean | { quota?: number; accept?: string[] },
    expiresIn?: number
  ): Promise<Ticket> {
    const ticketId = `tkt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const defaultExpiry = commit ? 300 : 3600;

    // Convert scope to array or undefined
    const scopeArr = scope === undefined ? undefined : Array.isArray(scope) ? scope : [scope];

    // Convert commit to CommitConfig or undefined
    const commitConfig: CommitConfig | undefined =
      commit === false || commit === undefined
        ? undefined
        : commit === true
          ? {}
          : { quota: commit.quota, accept: commit.accept };

    const ticket: Ticket = {
      pk: `token#${ticketId}`,
      type: "ticket",
      realm,
      issuerId,
      scope: scopeArr,
      commit: commitConfig,
      config: {
        nodeLimit: this.serverConfig.nodeLimit,
        maxNameBytes: this.serverConfig.maxNameBytes,
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + (expiresIn ?? defaultExpiry) * 1000,
    };
    this.tokens.set(ticket.pk, ticket);
    return ticket;
  }

  async deleteToken(tokenId: string): Promise<void> {
    this.tokens.delete(`token#${tokenId}`);
  }

  async verifyTokenOwnership(tokenId: string, userId: string): Promise<boolean> {
    const token = await this.getToken(tokenId);
    if (!token) return false;
    if (token.type === "user") {
      return token.userId === userId;
    }
    if (token.type === "ticket") {
      const issuer = await this.getToken(token.issuerId);
      if (!issuer) return false;
      if (issuer.type === "user") {
        return issuer.userId === userId;
      }
    }
    return false;
  }

  static extractTokenId(pk: string): string {
    return pk.replace("token#", "");
  }
}
