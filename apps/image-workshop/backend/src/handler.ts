/**
 * Image Workshop Stack - Lambda Handler
 *
 * AWS Lambda entry point for the Image Workshop service.
 * Uses awp-server-lambda for MCP/tool handling and custom auth routes.
 */

import { createServerHandler } from "@agent-web-portal/awp-server-lambda";
import { createAuthRoutes } from "./router.ts";
import { imageWorkshopSkills } from "./skills.ts";
import { fluxTools } from "./tools/flux/index.ts";
import { vectorizerTools } from "./tools/vectorizer/index.ts";
import { loadConfig } from "./types.ts";

// Load configuration
const config = loadConfig();

// Determine the base URL for skills (from callback URL or default)
const skillBaseUrl = config.callbackBaseUrl ? `${config.callbackBaseUrl}/api` : "";

// Create the Lambda handler using the builder pattern
export const handler = createServerHandler({
  name: "Image Workshop",
  version: "1.0.0",
  description: "AI Image Generation and Editing Workshop",
})
  .withCasConfig({
    endpoint: config.casEndpoint ?? "",
    agentToken: process.env.CAS_AGENT_TOKEN ?? "",
  })
  .registerTools(fluxTools)
  .registerTools(vectorizerTools)
  .registerSkills(imageWorkshopSkills)
  .withSkillBaseUrl(skillBaseUrl)
  .withRoutes(createAuthRoutes(config))
  .withLogging(true)
  .withCors(true)
  .build();
