/**
 * Memory Agent Tokens Storage
 *
 * In-memory implementation of AgentTokensDb for local development.
 */

import type { AgentTokenRecord, IAgentTokensDb } from "./types.ts";

export class MemoryAgentTokensDb implements IAgentTokensDb {
  private tokens = new Map<string, AgentTokenRecord>();

  async create(
    userId: string,
    name: string,
    options?: { description?: string; expiresIn?: number }
  ): Promise<AgentTokenRecord> {
    const id = `agt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const expiresIn = options?.expiresIn ?? 30 * 24 * 60 * 60; // 30 days default
    const token: AgentTokenRecord = {
      id,
      userId,
      name,
      description: options?.description,
      createdAt: Date.now(),
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(id, token);
    return token;
  }

  async listByUser(userId: string): Promise<AgentTokenRecord[]> {
    const now = Date.now();
    return Array.from(this.tokens.values()).filter(
      (t) => t.userId === userId && t.expiresAt > now
    );
  }

  async revoke(userId: string, tokenId: string): Promise<boolean> {
    const token = this.tokens.get(tokenId);
    if (!token || token.userId !== userId) {
      return false;
    }
    this.tokens.delete(tokenId);
    return true;
  }
}
