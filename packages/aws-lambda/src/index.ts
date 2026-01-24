/**
 * @agent-web-portal/aws-lambda
 *
 * AWS Lambda adapter for Agent Web Portal
 *
 * @example
 * ```typescript
 * import { createAgentWebPortalHandler, DynamoDBPendingAuthStore, DynamoDBPubkeyStore } from "@agent-web-portal/aws-lambda";
 * import { z } from "zod";
 *
 * const skillsConfig = {
 *   bucket: "my-bucket",
 *   prefix: "skills/",
 *   skills: [
 *     { name: "greeting-skill", s3Key: "greeting-skill.zip", frontmatter: { "allowed-tools": ["greet"] } },
 *   ],
 * };
 *
 * const pendingAuthStore = new DynamoDBPendingAuthStore({ tableName: "awp-auth" });
 * const pubkeyStore = new DynamoDBPubkeyStore({ tableName: "awp-auth" });
 *
 * export const handler = createAgentWebPortalHandler({ name: "my-portal" })
 *   .registerTool("greet", {
 *     inputSchema: z.object({ name: z.string() }),
 *     outputSchema: z.object({ message: z.string() }),
 *     handler: async ({ name }) => ({ message: `Hello, ${name}!` }),
 *   })
 *   .withAwpAuth({ pendingAuthStore, pubkeyStore })
 *   .withSkillsConfig(skillsConfig)
 *   .build();
 * ```
 */

// Primary API - fluent builder
export {
  createAgentWebPortalHandler,
  type LambdaHandler,
  LambdaHandlerBuilder,
  type LambdaHandlerBuilderOptions,
  type LambdaHandlerBuildOptions,
} from "./builder.ts";

// Low-level API - for advanced usage
export { createLambdaHandler } from "./handler.ts";

// DynamoDB store implementations
export {
  DynamoDBPendingAuthStore,
  type DynamoDBPendingAuthStoreOptions,
  DynamoDBPubkeyStore,
  type DynamoDBPubkeyStoreOptions,
} from "./stores/index.ts";

// Types
export type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  AwpAuthLambdaConfig,
  LambdaAdapterOptions,
  LambdaAuthContext,
  LambdaAuthMiddleware,
  LambdaAuthRequest,
  LambdaAuthResult,
  LambdaContext,
  LambdaRouteHandler,
  SkillConfig,
  SkillsConfig,
} from "./types.ts";
