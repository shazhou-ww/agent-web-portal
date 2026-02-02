/**
 * AWP Client management controller
 */

import type { Context } from "hono"
import { generateVerificationCode } from "@agent-web-portal/auth"
import type { AwpPendingDb } from "../db/awp-pending.ts"
import type { AwpPubkeysDb } from "../db/awp-pubkeys.ts"
import type { Env } from "../types.ts"

export type AuthClientsController = {
  init: (c: Context) => Promise<Response>
  status: (c: Context) => Promise<Response>
  complete: (c: Context<Env>) => Promise<Response>
  list: (c: Context<Env>) => Promise<Response>
  revoke: (c: Context<Env>) => Promise<Response>
}

type AuthClientsControllerDeps = {
  awpPendingDb: AwpPendingDb
  awpPubkeysDb: AwpPubkeysDb
}

export const createAuthClientsController = (
  deps: AuthClientsControllerDeps
): AuthClientsController => {
  const { awpPendingDb, awpPubkeysDb } = deps

  return {
    init: async (c) => {
      const body = await c.req.json()
      const { pubkey, client_name } = body

      const verificationCode = generateVerificationCode()
      const now = Date.now()
      const expiresIn = 600 // 10 minutes

      await awpPendingDb.create({
        pubkey,
        clientName: client_name,
        verificationCode,
        createdAt: now,
        expiresAt: now + expiresIn * 1000,
      })

      const origin = c.req.header("origin") ?? ""
      const authUrl = `${origin}/auth/awp?pubkey=${encodeURIComponent(pubkey)}`

      return c.json({
        auth_url: authUrl,
        verification_code: verificationCode,
        expires_in: expiresIn,
        poll_interval: 5,
      })
    },

    status: async (c) => {
      const pubkey = c.req.query("pubkey")
      if (!pubkey) {
        return c.json({ error: "Missing pubkey parameter" }, 400)
      }

      const authorized = await awpPubkeysDb.lookup(pubkey)
      if (authorized) {
        return c.json({
          authorized: true,
          expires_at: authorized.expiresAt,
        })
      }

      const pending = await awpPendingDb.get(pubkey)
      if (!pending) {
        return c.json({
          authorized: false,
          error: "No pending authorization found",
        })
      }

      return c.json({ authorized: false })
    },

    complete: async (c) => {
      const auth = c.get("auth")
      const body = await c.req.json()
      const { pubkey, verification_code } = body

      const isValid = await awpPendingDb.validateCode(pubkey, verification_code)
      if (!isValid) {
        return c.json({ error: "Invalid or expired verification code" }, 400)
      }

      const pending = await awpPendingDb.get(pubkey)
      if (!pending) {
        return c.json({ error: "Pending authorization not found" }, 400)
      }

      const now = Date.now()
      const expiresAt = now + 30 * 24 * 60 * 60 * 1000 // 30 days

      await awpPubkeysDb.store({
        pubkey,
        userId: auth.userId,
        clientName: pending.clientName,
        createdAt: now,
        expiresAt,
      })

      await awpPendingDb.delete(pubkey)

      return c.json({ success: true, expires_at: expiresAt })
    },

    list: async (c) => {
      const auth = c.get("auth")
      const clients = await awpPubkeysDb.listByUser(auth.userId)

      return c.json({
        clients: clients.map((client) => ({
          pubkey: client.pubkey,
          clientName: client.clientName,
          createdAt: new Date(client.createdAt).toISOString(),
          expiresAt: client.expiresAt ? new Date(client.expiresAt).toISOString() : null,
        })),
      })
    },

    revoke: async (c) => {
      const auth = c.get("auth")
      const pubkey = decodeURIComponent(c.req.param("pubkey"))

      const client = await awpPubkeysDb.lookup(pubkey)
      if (!client || client.userId !== auth.userId) {
        return c.json({ error: "Client not found or access denied" }, 404)
      }

      await awpPubkeysDb.revoke(pubkey)
      return c.json({ success: true })
    },
  }
}
