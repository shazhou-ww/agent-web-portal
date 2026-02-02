/**
 * Agent Token management controller
 */

import type { Context } from "hono"
import type { TokensDb } from "../db/tokens.ts"
import type { Env } from "../types.ts"
import { extractTokenId } from "../util/token-id.ts"

export type AuthTokensController = {
  create: (c: Context<Env>) => Promise<Response>
  list: (c: Context<Env>) => Promise<Response>
  revoke: (c: Context<Env>) => Promise<Response>
}

type AuthTokensControllerDeps = {
  tokensDb: TokensDb
}

export const createAuthTokensController = (
  deps: AuthTokensControllerDeps
): AuthTokensController => {
  const { tokensDb } = deps

  return {
    create: async (c) => {
      const auth = c.get("auth")
      const body = await c.req.json()

      const token = await tokensDb.createAgentToken(auth.userId, body.name, {
        description: body.description,
        expiresIn: body.expiresIn,
      })

      const tokenId = extractTokenId(token.pk)

      return c.json(
        {
          id: tokenId,
          name: token.name,
          description: token.description,
          expiresAt: new Date(token.expiresAt).toISOString(),
          createdAt: new Date(token.createdAt).toISOString(),
        },
        201
      )
    },

    list: async (c) => {
      const auth = c.get("auth")
      const tokens = await tokensDb.listAgentTokensByUser(auth.userId)

      return c.json({
        tokens: tokens.map((t) => ({
          id: extractTokenId(t.pk),
          name: t.name,
          description: t.description,
          expiresAt: new Date(t.expiresAt).toISOString(),
          createdAt: new Date(t.createdAt).toISOString(),
        })),
      })
    },

    revoke: async (c) => {
      const auth = c.get("auth")
      const tokenId = c.req.param("id")

      try {
        await tokensDb.revokeAgentToken(auth.userId, tokenId)
        return c.json({ success: true })
      } catch (error: unknown) {
        const err = error as Error
        return c.json({ error: err.message ?? "Token not found" }, 404)
      }
    },
  }
}
