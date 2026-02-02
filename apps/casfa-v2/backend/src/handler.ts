/**
 * CASFA v2 - Lambda Handler
 */

import { handle } from "hono/aws-lambda"
import { createApp } from "./app.ts"

// Create app once (outside handler for Lambda warm start)
const app = createApp()

// Lambda handler
export const handler = handle(app)
