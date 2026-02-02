/**
 * CASFA v2 - Local Development Server
 */

import { createApp } from "./src/app.ts"

const port = Number.parseInt(process.env.CAS_API_PORT ?? process.env.PORT ?? "3560", 10)

// Create app with memory storage for local development
const app = createApp({ useMemoryStorage: true })

console.log(`[CASFA v2] Starting local development server...`)
console.log(`[CASFA v2] Listening on http://localhost:${port}`)
console.log(`[CASFA v2] Using in-memory storage`)

// Use Bun's native server
Bun.serve({
  port,
  fetch: app.fetch,
})
