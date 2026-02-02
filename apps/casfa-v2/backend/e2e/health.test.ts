/**
 * E2E Tests: Health Check
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { createE2EContext, type E2EContext } from "./setup.ts"

describe("Health Check", () => {
  let ctx: E2EContext

  beforeAll(() => {
    ctx = createE2EContext()
  })

  afterAll(() => {
    ctx.cleanup()
  })

  it("should return healthy status", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`)

    expect(response.status).toBe(200)

    const data = (await response.json()) as { status: string }
    expect(data.status).toBe("ok")
  })
})
