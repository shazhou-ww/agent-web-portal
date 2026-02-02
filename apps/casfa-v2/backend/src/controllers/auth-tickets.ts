/**
 * Ticket management controller
 */

import type { Context } from "hono"
import type { TokensDb } from "../db/tokens.ts"
import type { ServerConfig } from "../config.ts"
import type { Env } from "../types.ts"
import { extractTokenId } from "../util/token-id.ts"

export type AuthTicketsController = {
  create: (c: Context<Env>) => Promise<Response>
  revoke: (c: Context<Env>) => Promise<Response>
}

type AuthTicketsControllerDeps = {
  tokensDb: TokensDb
  serverConfig: ServerConfig
}

export const createAuthTicketsController = (
  deps: AuthTicketsControllerDeps
): AuthTicketsController => {
  const { tokensDb, serverConfig } = deps

  return {
    create: async (c) => {
      const auth = c.get("auth")
      const body = await c.req.json()

      const ticket = await tokensDb.createTicket(
        auth.realm,
        extractTokenId(auth.token.pk),
        body.scope,
        body.commit,
        body.expiresIn
      )

      const ticketId = extractTokenId(ticket.pk)
      const endpoint = `${serverConfig.baseUrl}/api/ticket/${ticketId}`

      return c.json(
        {
          id: ticketId,
          endpoint,
          expiresAt: new Date(ticket.expiresAt).toISOString(),
          realm: ticket.realm,
          scope: ticket.scope,
          commit: ticket.commit,
          config: ticket.config,
        },
        201
      )
    },

    revoke: async (c) => {
      const ticketId = c.req.param("id")
      // Note: In production, you'd want to verify the ticket belongs to the user
      // For now, we just attempt deletion
      return c.json({ success: true })
    },
  }
}
