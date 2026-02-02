/**
 * In-memory implementation of TokensDb for testing
 */

import type { AgentToken, Ticket, Token, UserToken } from "../types.ts"
import type { TokensDb } from "../db/tokens.ts"
import { loadServerConfig } from "../config.ts"
import { generateTicketId, generateAgentTokenId, toTokenPk } from "../util/token-id.ts"

// ============================================================================
// Factory
// ============================================================================

export const createMemoryTokensDb = (): TokensDb & { _store: Map<string, Token>; _clear: () => void } => {
  const store = new Map<string, Token>()

  const generateUserTokenId = (): string => {
    const timestamp = Date.now().toString(36)
    const random = Math.random().toString(36).substring(2, 10)
    return `usr_${timestamp}${random}`
  }

  const getToken = async (tokenId: string): Promise<Token | null> => {
    const token = store.get(toTokenPk(tokenId))
    if (!token) return null
    if (token.expiresAt && token.expiresAt < Date.now()) return null
    return token
  }

  const getTicket = async (ticketId: string): Promise<Ticket | null> => {
    const token = await getToken(ticketId)
    if (!token || token.type !== "ticket") return null
    return token as Ticket
  }

  const createUserToken = async (
    userId: string,
    refreshToken: string,
    expiresIn = 3600
  ): Promise<UserToken> => {
    const tokenId = generateUserTokenId()
    const now = Date.now()
    const expiresAt = now + expiresIn * 1000

    const token: UserToken = {
      pk: toTokenPk(tokenId),
      type: "user",
      userId,
      refreshToken,
      createdAt: now,
      expiresAt,
    }

    store.set(token.pk, token)
    return token
  }

  const createAgentToken = async (
    userId: string,
    name: string,
    options: { description?: string; expiresIn?: number } = {}
  ): Promise<AgentToken> => {
    const serverConfig = loadServerConfig()
    const tokenId = generateAgentTokenId()
    const now = Date.now()
    const expiresIn = options.expiresIn ?? 2592000 // 30 days default
    const cappedExpiresIn = Math.min(expiresIn, serverConfig.maxAgentTokenTtl)
    const expiresAt = now + cappedExpiresIn * 1000

    const token: AgentToken = {
      pk: toTokenPk(tokenId),
      type: "agent",
      userId,
      name,
      description: options.description,
      createdAt: now,
      expiresAt,
    }

    store.set(token.pk, token)
    return token
  }

  const createTicket = async (
    realm: string,
    issuerId: string,
    options?: {
      scope?: string[]
      commit?: { quota?: number; accept?: string[] }
      expiresIn?: number
      issuerFingerprint?: string
    }
  ): Promise<Ticket> => {
    const { scope, commit, expiresIn, issuerFingerprint } = options ?? {}
    const serverConfig = loadServerConfig()
    const ticketId = generateTicketId()
    const now = Date.now()
    const requestedExpiresIn = expiresIn ?? 3600
    const cappedExpiresIn = Math.min(requestedExpiresIn, serverConfig.maxTicketTtl)
    const expiresAt = now + cappedExpiresIn * 1000

    const ticket: Ticket = {
      pk: toTokenPk(ticketId),
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
    }

    store.set(ticket.pk, ticket)
    return ticket
  }

  const markTicketCommitted = async (ticketId: string, root: string): Promise<boolean> => {
    const ticket = await getTicket(ticketId)
    if (!ticket) return false

    // Check if already committed
    if (ticket.commit?.root) return false

    // Update the ticket
    const updatedTicket: Ticket = {
      ...ticket,
      commit: {
        ...ticket.commit,
        root,
      },
    }

    store.set(ticket.pk, updatedTicket)
    return true
  }

  const revokeAgentToken = async (userId: string, tokenId: string): Promise<void> => {
    const token = await getToken(tokenId)
    if (!token || token.type !== "agent" || (token as AgentToken).userId !== userId) {
      throw new Error("Token not found or access denied")
    }
    store.delete(toTokenPk(tokenId))
  }

  const listAgentTokensByUser = async (userId: string): Promise<AgentToken[]> => {
    const now = Date.now()
    const tokens: AgentToken[] = []

    for (const token of store.values()) {
      if (
        token.type === "agent" &&
        (token as AgentToken).userId === userId &&
        (!token.expiresAt || token.expiresAt > now)
      ) {
        tokens.push(token as AgentToken)
      }
    }

    return tokens
  }

  const deleteToken = async (tokenId: string): Promise<void> => {
    store.delete(toTokenPk(tokenId))
  }

  const revokeTicket = async (
    realm: string,
    ticketId: string,
    agentFingerprint?: string
  ): Promise<void> => {
    const ticket = await getTicket(ticketId)
    if (!ticket) {
      throw new Error("Ticket not found")
    }

    if (ticket.realm !== realm) {
      throw new Error("Ticket not found or access denied")
    }

    if (agentFingerprint !== undefined) {
      if (ticket.issuerFingerprint !== agentFingerprint) {
        throw new Error("Access denied: can only revoke tickets you issued")
      }
    }

    await deleteToken(ticketId)
  }

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
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
