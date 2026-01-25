/**
 * Lambda Handler Builder for Agent Web Portal
 *
 * Provides a fluent API for creating Lambda handlers with integrated
 * tool and skill registration.
 */

import {
  type AgentWebPortalOptions,
  createAgentWebPortal,
  type SkillRegistrationOptions,
  type ToolRegistrationOptions,
} from "@agent-web-portal/core";
import type { ZodSchema } from "zod";
import { createLambdaHandler } from "./handler.ts";
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  AwpAuthLambdaConfig,
  LambdaAdapterOptions,
  LambdaAuthMiddleware,
  LambdaContext,
  LambdaRouteHandler,
  SkillsConfig,
} from "./types.ts";

/**
 * Lambda Handler type
 */
export type LambdaHandler = (
  event: APIGatewayProxyEvent,
  context: LambdaContext
) => Promise<APIGatewayProxyResult>;

/**
 * Options for creating a Lambda handler builder (intrinsic properties)
 */
export interface LambdaHandlerBuilderOptions extends AgentWebPortalOptions {
  /** S3 client region (defaults to AWS_REGION env) */
  region?: string;
  /** Presigned URL expiration in seconds (default: 3600) */
  presignedUrlExpiration?: number;
}

/**
 * Options for build() - runtime behavior configuration
 */
export interface LambdaHandlerBuildOptions {
  /**
   * Enable automatic coercion of stringified arguments for XML-based MCP clients.
   *
   * Some MCP clients (like those using XML as a carrier format) serialize all
   * tool arguments as strings. When enabled, if argument validation fails,
   * the portal will attempt to parse each string argument as JSON and retry
   * validation.
   *
   * @default false
   */
  coerceXmlClientArgs?: boolean;
}

/**
 * Lambda Handler Builder
 *
 * A fluent builder for creating AWS Lambda handlers with Agent Web Portal.
 * Automatically handles skill registration from SkillsConfig.
 *
 * @example
 * ```typescript
 * import { createAgentWebPortalHandler } from "@agent-web-portal/aws-lambda";
 * import { z } from "zod";
 *
 * const skillsConfig = {
 *   bucket: "my-bucket",
 *   prefix: "skills/",
 *   skills: [
 *     { name: "greeting-skill", s3Key: "skills/greeting-skill.zip", frontmatter: { "allowed-tools": ["greet"] } },
 *   ],
 * };
 *
 * export const handler = createAgentWebPortalHandler({ name: "my-portal" })
 *   .registerTool("greet", {
 *     inputSchema: z.object({ name: z.string() }),
 *     outputSchema: z.object({ message: z.string() }),
 *     handler: async ({ name }) => ({ message: `Hello, ${name}!` }),
 *   })
 *   .withSkillsConfig(skillsConfig)
 *   .build();
 * ```
 */
export class LambdaHandlerBuilder {
  private portalOptions: AgentWebPortalOptions;
  private lambdaOptions: Omit<LambdaAdapterOptions, "skillsConfig" | "skillsConfigPath">;
  private tools: Array<{
    name: string;
    options: ToolRegistrationOptions<ZodSchema, ZodSchema>;
  }> = [];
  private skills: Record<string, SkillRegistrationOptions> = {};
  private skillsConfig?: SkillsConfig;
  private authMiddleware?: LambdaAuthMiddleware;
  private awpAuthConfig?: AwpAuthLambdaConfig;
  private customRoutes: LambdaRouteHandler[] = [];

  constructor(options: LambdaHandlerBuilderOptions = {}) {
    this.portalOptions = {
      name: options.name ?? "agent-web-portal",
      version: options.version ?? "1.0.0",
      description: options.description ?? "Agent Web Portal Lambda",
    };
    this.lambdaOptions = {
      region: options.region,
      presignedUrlExpiration: options.presignedUrlExpiration,
    };
  }

  /**
   * Register a tool with input/output schemas and handler
   *
   * @param name - Unique tool name
   * @param options - Tool definition with schemas and handler
   * @returns this - for method chaining
   */
  registerTool<TInputSchema extends ZodSchema, TOutputSchema extends ZodSchema>(
    name: string,
    options: ToolRegistrationOptions<TInputSchema, TOutputSchema>
  ): this {
    this.tools.push({
      name,
      options: options as unknown as ToolRegistrationOptions<ZodSchema, ZodSchema>,
    });
    return this;
  }

  /**
   * Register multiple skills at once
   *
   * @param skills - Map of skill names to skill definitions
   * @returns this - for method chaining
   */
  registerSkills(skills: Record<string, SkillRegistrationOptions>): this {
    this.skills = { ...this.skills, ...skills };
    return this;
  }

  /**
   * Set skills configuration from skills.yaml
   *
   * This will automatically register skills from the config and
   * configure S3 presigned URL generation for skill downloads.
   *
   * @param config - Skills configuration object
   * @returns this - for method chaining
   */
  withSkillsConfig(config: SkillsConfig): this {
    this.skillsConfig = config;

    // Auto-register skills from config
    const skillsFromConfig: Record<string, SkillRegistrationOptions> = {};
    for (const skill of config.skills) {
      skillsFromConfig[skill.name] = {
        url: `/skills/${skill.name}`,
        frontmatter: skill.frontmatter,
      };
    }
    this.skills = { ...this.skills, ...skillsFromConfig };

    return this;
  }

  /**
   * Add authentication middleware
   *
   * The middleware will be called for each request before processing.
   * If the middleware returns `authorized: false`, the challenge response
   * will be returned to the client.
   *
   * @param middleware - Auth middleware function from @agent-web-portal/auth
   * @returns this - for method chaining
   *
   * @example
   * ```typescript
   * import { createAwpAuthMiddleware } from "@agent-web-portal/auth";
   *
   * const authMiddleware = createAwpAuthMiddleware({
   *   pendingAuthStore: new DynamoDBPendingAuthStore({ tableName: "auth" }),
   *   pubkeyStore: new DynamoDBPubkeyStore({ tableName: "auth" }),
   * });
   *
   * export const handler = createAgentWebPortalHandler({ name: "my-portal" })
   *   .withMiddleware(authMiddleware)
   *   .registerTool("greet", { ... })
   *   .build();
   * ```
   */
  withMiddleware(middleware: LambdaAuthMiddleware): this {
    this.authMiddleware = middleware;
    return this;
  }

  /**
   * Configure AWP authentication with stores
   *
   * This sets up the AWP auth flow including:
   * - Auth initiation endpoint (/auth/init)
   * - Auth status polling endpoint (/auth/status)
   * - Request signature verification middleware
   *
   * **Note:** The auth completion endpoint (/auth/complete) is NOT automatically
   * handled because it requires application-specific user session validation.
   * Use `withRoutes()` to add your own implementation.
   *
   * @param config - AWP auth configuration with stores
   * @returns this - for method chaining
   *
   * @example
   * ```typescript
   * import { DynamoDBPendingAuthStore, DynamoDBPubkeyStore } from "@agent-web-portal/aws-lambda";
   * import { completeAuthorization } from "@agent-web-portal/auth";
   *
   * const pendingAuthStore = new DynamoDBPendingAuthStore({ tableName: "awp-auth" });
   * const pubkeyStore = new DynamoDBPubkeyStore({ tableName: "awp-auth" });
   *
   * export const handler = createAgentWebPortalHandler({ name: "my-portal" })
   *   .withAwpAuth({ pendingAuthStore, pubkeyStore })
   *   // Add custom route for auth completion
   *   .withRoutes(async (request) => {
   *     const url = new URL(request.url);
   *     if (url.pathname === "/auth/complete" && request.method === "POST") {
   *       // Get userId from your session/JWT (application-specific)
   *       const userId = await getUserFromSession(request);
   *       if (!userId) {
   *         return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
   *       }
   *       const body = JSON.parse(await request.text());
   *       const result = await completeAuthorization(
   *         body.pubkey,
   *         body.verification_code,
   *         userId,
   *         { pendingAuthStore, pubkeyStore }
   *       );
   *       return new Response(JSON.stringify(result), {
   *         status: result.success ? 200 : 400,
   *         headers: { "Content-Type": "application/json" },
   *       });
   *     }
   *     return null;
   *   })
   *   .registerTool("greet", { ... })
   *   .build();
   * ```
   */
  withAwpAuth(config: AwpAuthLambdaConfig): this {
    this.awpAuthConfig = config;
    return this;
  }

  /**
   * Add custom route handlers
   *
   * Route handlers are called before the default routes. If a handler
   * returns a Response, it will be used. If it returns null, the next
   * handler (or default routes) will be tried.
   *
   * @param handler - Route handler function
   * @returns this - for method chaining
   */
  withRoutes(handler: LambdaRouteHandler): this {
    this.customRoutes.push(handler);
    return this;
  }

  /**
   * Build the Lambda handler
   *
   * Creates the Agent Web Portal instance and wraps it in a Lambda handler.
   *
   * @param buildOptions - Runtime behavior configuration
   * @returns Lambda handler function
   */
  build(buildOptions: LambdaHandlerBuildOptions = {}): LambdaHandler {
    // Build the portal
    const builder = createAgentWebPortal(this.portalOptions);

    // Register all tools
    for (const { name, options } of this.tools) {
      builder.registerTool(name, options);
    }

    // Register all skills
    if (Object.keys(this.skills).length > 0) {
      builder.registerSkills(this.skills);
    }

    // Build with runtime options
    const portal = builder.build({
      coerceXmlClientArgs: buildOptions.coerceXmlClientArgs ?? false,
    });

    // If awpAuth is configured, create the auth middleware
    let authMiddleware = this.authMiddleware;
    if (this.awpAuthConfig && !authMiddleware) {
      // Lazy import to avoid circular dependencies
      const createMiddleware = async () => {
        const { createAwpAuthMiddleware } = await import("@agent-web-portal/auth");
        return createAwpAuthMiddleware({
          pendingAuthStore: this.awpAuthConfig!.pendingAuthStore,
          pubkeyStore: this.awpAuthConfig!.pubkeyStore,
          maxClockSkew: this.awpAuthConfig!.maxClockSkew,
          excludePaths: this.awpAuthConfig!.excludePaths,
          authInitPath: this.awpAuthConfig!.authInitPath,
          authStatusPath: this.awpAuthConfig!.authStatusPath,
          authPagePath: this.awpAuthConfig!.authPagePath,
        });
      };

      // Create a wrapper that creates the middleware on first call
      let middlewarePromise: Promise<LambdaAuthMiddleware> | null = null;
      authMiddleware = async (request) => {
        if (!middlewarePromise) {
          middlewarePromise = createMiddleware();
        }
        const middleware = await middlewarePromise;
        return middleware(request);
      };
    }

    // Create and return the Lambda handler
    return createLambdaHandler(portal, {
      ...this.lambdaOptions,
      skillsConfig: this.skillsConfig,
      authMiddleware,
      awpAuth: this.awpAuthConfig,
      customRoutes: this.customRoutes.length > 0 ? this.customRoutes : undefined,
    });
  }
}

/**
 * Create a new Lambda handler builder
 *
 * @param options - Optional configuration
 * @returns LambdaHandlerBuilder instance
 *
 * @example
 * ```typescript
 * import { createAgentWebPortalHandler } from "@agent-web-portal/aws-lambda";
 *
 * export const handler = createAgentWebPortalHandler({ name: "my-portal" })
 *   .registerTool("greet", { ... })
 *   .withSkillsConfig(skillsConfig)
 *   .build();
 * ```
 */
export function createAgentWebPortalHandler(
  options?: LambdaHandlerBuilderOptions
): LambdaHandlerBuilder {
  return new LambdaHandlerBuilder(options);
}
