/**
 * E2E Tests: Health Check
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createE2EContext, type E2EContext } from "./setup.ts";

describe("Health Check", () => {
  let ctx: E2EContext;

  beforeAll(async () => {
    ctx = createE2EContext();
    await ctx.ready();
  });

  afterAll(() => {
    ctx.cleanup();
  });

  it("should return healthy status", async () => {
    const response = await fetch(`${ctx.baseUrl}/api/health`);

    expect(response.status).toBe(200);

    const data = (await response.json()) as { status: string };
    expect(data.status).toBe("ok");
  });
});
