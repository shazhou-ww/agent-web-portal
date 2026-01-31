/**
 * AWP Server Lambda - Handler Builder
 *
 * Provides a fluent API for creating AWS Lambda handlers with AWP Server.
 */

import {
  type CasConfig,
  createServerPortal,
  type DefinedSkill,
  type DefinedTool,
  type ServerPortalConfig,
} from "@agent-web-portal/awp-server-core";

import { createLambdaHandler } from "./handler.ts";
import type {
  LambdaCasConfig,
  LambdaHandler,
  LambdaHandlerBuilderOptions,
  LambdaHandlerBuildOptions,
  LambdaRouteHandler,
} from "./types.ts";

/**
 * Lambda Handler Builder
 *
 * A fluent builder for creating AWS Lambda handlers with AWP Server.
 *
 * @example
 * ```typescript
 * import { createServerHandler, defineTool } from "@agent-web-portal/awp-server-lambda";
 * import { z } from "zod";
 *
 * const processImage = defineTool((cas) => ({
 *   name: "process-image",
 *   inputSchema: z.object({ imageKey: z.string() }),
 *   outputSchema: z.object({ resultKey: z.string() }),
 *   handler: async ({ imageKey }) => {
 *     const file = await cas.openFile(imageKey);
 *     // ... process image ...
 *     const resultKey = await cas.putFile(result, "image/png");
 *     return { resultKey };
 *   },
 * }));
 *
 * export const handler = createServerHandler({ name: "my-server" })
 *   .withCasConfig({
 *     endpoint: process.env.CAS_ENDPOINT!,
 *     agentToken: process.env.CAS_AGENT_TOKEN!,
 *   })
 *   .registerTool(processImage)
 *   .build();
 * ```
 */
export class LambdaHandlerBuilder {
  private portalConfig: ServerPortalConfig;
  private casConfig?: CasConfig;
  private tools: DefinedTool[] = [];
  private skills: DefinedSkill[] = [];
  private skillBaseUrl?: string;
  private customRoutes: LambdaRouteHandler[] = [];
  private buildOptions: LambdaHandlerBuildOptions = {
    cors: true,
    corsOrigin: "*",
    logging: false,
  };

  constructor(options: Partial<LambdaHandlerBuilderOptions> = {}) {
    this.portalConfig = {
      name: options.name ?? "awp-server",
      version: options.version ?? "1.0.0",
      description: options.description,
    };

    if (options.cas) {
      this.casConfig = options.cas;
    }
  }

  /**
   * Configure CAS integration
   *
   * @param config - CAS configuration
   * @returns this for method chaining
   */
  withCasConfig(config: LambdaCasConfig): this {
    this.casConfig = config;
    return this;
  }

  /**
   * Register a tool
   *
   * @param tool - The defined tool to register
   * @returns this for method chaining
   */
  registerTool(tool: DefinedTool): this {
    this.tools.push(tool);
    return this;
  }

  /**
   * Register multiple tools at once
   *
   * @param tools - Array of defined tools
   * @returns this for method chaining
   */
  registerTools(tools: DefinedTool[]): this {
    this.tools.push(...tools);
    return this;
  }

  /**
   * Register a skill
   *
   * @param skill - The defined skill to register
   * @returns this for method chaining
   */
  registerSkill(skill: DefinedSkill): this {
    this.skills.push(skill);
    return this;
  }

  /**
   * Register multiple skills at once
   *
   * @param skills - Array of defined skills
   * @returns this for method chaining
   */
  registerSkills(skills: DefinedSkill[]): this {
    this.skills.push(...skills);
    return this;
  }

  /**
   * Set the base URL for skill downloads
   *
   * @param baseUrl - Base URL for skill content (e.g., "https://example.com/api")
   * @returns this for method chaining
   */
  withSkillBaseUrl(baseUrl: string): this {
    this.skillBaseUrl = baseUrl;
    return this;
  }

  /**
   * Add custom route handlers
   *
   * Route handlers are called before the default MCP routes.
   * If a handler returns a Response, it will be used.
   * If it returns null, the next handler (or default routes) will be tried.
   *
   * @param handler - Route handler function
   * @returns this for method chaining
   */
  withRoutes(handler: LambdaRouteHandler): this {
    this.customRoutes.push(handler);
    return this;
  }

  /**
   * Configure CORS settings
   *
   * @param enabled - Whether to enable CORS headers
   * @param origin - CORS origin header value (default: "*")
   * @returns this for method chaining
   */
  withCors(enabled: boolean, origin?: string): this {
    this.buildOptions.cors = enabled;
    if (origin) {
      this.buildOptions.corsOrigin = origin;
    }
    return this;
  }

  /**
   * Enable request logging
   *
   * @param enabled - Whether to enable logging
   * @returns this for method chaining
   */
  withLogging(enabled: boolean): this {
    this.buildOptions.logging = enabled;
    return this;
  }

  /**
   * Build the Lambda handler
   *
   * Creates the ServerPortal instance and wraps it in a Lambda handler.
   *
   * @param options - Additional build options
   * @returns Lambda handler function
   */
  build(options?: Partial<LambdaHandlerBuildOptions>): LambdaHandler {
    // Merge build options
    const finalOptions: LambdaHandlerBuildOptions = {
      ...this.buildOptions,
      ...options,
    };

    // Create the portal with CAS config if provided
    const portalConfig: ServerPortalConfig = {
      ...this.portalConfig,
    };

    if (this.casConfig) {
      portalConfig.cas = this.casConfig;
    }

    const portal = createServerPortal(portalConfig);

    // Register all tools
    for (const tool of this.tools) {
      portal.registerTool(tool);
    }

    // Set skill base URL if provided
    if (this.skillBaseUrl) {
      portal.setSkillBaseUrl(this.skillBaseUrl);
    }

    // Register all skills
    for (const skill of this.skills) {
      portal.registerSkill(skill);
    }

    // Create skill content route handler if skills are registered
    const skillRoutes: LambdaRouteHandler[] = [];
    if (this.skills.length > 0) {
      skillRoutes.push(this.createSkillContentHandler(portal));
    }

    // Create and return the Lambda handler
    return createLambdaHandler(portal, {
      ...finalOptions,
      customRoutes: [...skillRoutes, ...this.customRoutes],
    });
  }

  /**
   * Create a route handler for serving skill content
   */
  private createSkillContentHandler(
    portal: ReturnType<typeof createServerPortal>
  ): LambdaRouteHandler {
    return async (request: Request): Promise<Response | null> => {
      const url = new URL(request.url);
      const path = url.pathname;

      // Match /api/skills/{skillId}.md
      const skillMatch = path.match(/^\/api\/skills\/(.+)\.md$/);
      if (!skillMatch || request.method !== "GET") {
        return null;
      }

      const skillId = skillMatch[1];
      const skill = portal.getSkill(skillId!);

      if (!skill) {
        return new Response(JSON.stringify({ error: "Skill not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(skill.content, {
        status: 200,
        headers: {
          "Content-Type": "text/markdown; charset=utf-8",
          "Cache-Control": "public, max-age=3600",
        },
      });
    };
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
 * import { createServerHandler } from "@agent-web-portal/awp-server-lambda";
 *
 * export const handler = createServerHandler({ name: "my-server" })
 *   .withCasConfig({
 *     endpoint: process.env.CAS_ENDPOINT!,
 *     agentToken: process.env.CAS_AGENT_TOKEN!,
 *   })
 *   .registerTool(myTool)
 *   .build();
 * ```
 */
export function createServerHandler(
  options?: Partial<LambdaHandlerBuilderOptions>
): LambdaHandlerBuilder {
  return new LambdaHandlerBuilder(options);
}
