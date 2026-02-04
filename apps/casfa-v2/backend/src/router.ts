/**
 * CASFA v2 - Hono Router
 */

import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AdminController } from "./controllers/admin.ts";
import type { AuthClientsController } from "./controllers/auth-clients.ts";
import type { AuthTokensController } from "./controllers/auth-tokens.ts";
import type { ChunksController } from "./controllers/chunks.ts";
import type { DepotsController } from "./controllers/depots.ts";
import type { HealthController } from "./controllers/health.ts";
import type { OAuthController } from "./controllers/oauth.ts";
import type { RealmController } from "./controllers/realm.ts";
import type { TicketsController } from "./controllers/tickets.ts";
import type { McpController } from "./mcp/handler.ts";
import {
  AwpAuthCompleteSchema,
  AwpAuthInitSchema,
  DepotCommitSchema as CommitDepotSchema,
  CreateAgentTokenSchema,
  CreateDepotSchema,
  CreateTicketSchema,
  ListTicketsQuerySchema,
  LoginSchema,
  PrepareNodesSchema,
  RefreshSchema,
  TicketCommitSchema,
  TokenExchangeSchema,
  UpdateDepotSchema,
  UpdateUserRoleSchema,
} from "./schemas/index.ts";
import type { Env } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

export type RouterDeps = {
  // Controllers
  health: HealthController;
  oauth: OAuthController;
  authClients: AuthClientsController;
  authTokens: AuthTokensController;
  admin: AdminController;
  realm: RealmController;
  tickets: TicketsController;
  chunks: ChunksController;
  depots: DepotsController;
  mcp: McpController;
  // Middleware
  authMiddleware: MiddlewareHandler<Env>;
  ticketAuthMiddleware: MiddlewareHandler<Env>;
  realmAccessMiddleware: MiddlewareHandler<Env>;
  writeAccessMiddleware: MiddlewareHandler<Env>;
  adminAccessMiddleware: MiddlewareHandler<Env>;
};

// ============================================================================
// Router Factory
// ============================================================================

export const createRouter = (deps: RouterDeps): Hono<Env> => {
  const app = new Hono<Env>();

  // CORS
  app.use(
    "*",
    cors({
      origin: "*",
      allowHeaders: [
        "Content-Type",
        "Authorization",
        "X-AWP-Pubkey",
        "X-AWP-Timestamp",
        "X-AWP-Signature",
      ],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    })
  );

  // ============================================================================
  // Health
  // ============================================================================

  app.get("/api/health", deps.health.check);

  // ============================================================================
  // OAuth Routes
  // ============================================================================

  app.get("/api/oauth/config", deps.oauth.getConfig);
  app.post("/api/oauth/login", zValidator("json", LoginSchema), deps.oauth.login);
  app.post("/api/oauth/refresh", zValidator("json", RefreshSchema), deps.oauth.refresh);
  app.post("/api/oauth/token", zValidator("json", TokenExchangeSchema), deps.oauth.exchangeToken);
  app.get("/api/oauth/me", deps.authMiddleware, deps.oauth.me);

  // ============================================================================
  // Auth Routes - Clients
  // ============================================================================

  app.post("/api/auth/clients/init", zValidator("json", AwpAuthInitSchema), deps.authClients.init);
  app.get("/api/auth/clients/status", deps.authClients.status);
  app.post(
    "/api/auth/clients/complete",
    deps.authMiddleware,
    zValidator("json", AwpAuthCompleteSchema),
    deps.authClients.complete
  );
  app.get("/api/auth/clients", deps.authMiddleware, deps.authClients.list);
  app.delete("/api/auth/clients/:pubkey", deps.authMiddleware, deps.authClients.revoke);

  // ============================================================================
  // Auth Routes - Tokens
  // ============================================================================

  app.post(
    "/api/auth/tokens",
    deps.authMiddleware,
    zValidator("json", CreateAgentTokenSchema),
    deps.authTokens.create
  );
  app.get("/api/auth/tokens", deps.authMiddleware, deps.authTokens.list);
  app.delete("/api/auth/tokens/:id", deps.authMiddleware, deps.authTokens.revoke);

  // ============================================================================
  // MCP Route
  // ============================================================================

  app.post("/api/mcp", deps.authMiddleware, deps.mcp.handle);

  // ============================================================================
  // Admin Routes
  // ============================================================================

  app.get(
    "/api/admin/users",
    deps.authMiddleware,
    deps.adminAccessMiddleware,
    deps.admin.listUsers
  );
  app.patch(
    "/api/admin/users/:userId",
    deps.authMiddleware,
    deps.adminAccessMiddleware,
    zValidator("json", UpdateUserRoleSchema),
    deps.admin.updateRole
  );

  // ============================================================================
  // Realm Routes
  // ============================================================================

  const realmRouter = new Hono<Env>();
  realmRouter.use("*", deps.authMiddleware);
  realmRouter.use("/:realmId/*", deps.realmAccessMiddleware);

  // Realm info
  realmRouter.get("/:realmId", deps.realm.getInfo);
  realmRouter.get("/:realmId/usage", deps.realm.getUsage);

  // Tickets
  realmRouter.post(
    "/:realmId/tickets",
    deps.writeAccessMiddleware,
    zValidator("json", CreateTicketSchema),
    deps.tickets.create
  );
  realmRouter.get("/:realmId/tickets", deps.tickets.list);
  realmRouter.get("/:realmId/tickets/:ticketId", deps.tickets.get);
  realmRouter.post(
    "/:realmId/tickets/:ticketId/commit",
    zValidator("json", TicketCommitSchema),
    deps.tickets.commit
  );
  realmRouter.post("/:realmId/tickets/:ticketId/revoke", deps.tickets.revoke);
  realmRouter.delete("/:realmId/tickets/:ticketId", deps.tickets.delete);

  // Nodes
  realmRouter.post(
    "/:realmId/prepare-nodes",
    zValidator("json", PrepareNodesSchema),
    deps.chunks.prepareNodes
  );
  realmRouter.put("/:realmId/nodes/:key", deps.writeAccessMiddleware, deps.chunks.put);
  realmRouter.get("/:realmId/nodes/:key", deps.chunks.get);
  realmRouter.get("/:realmId/nodes/:key/metadata", deps.chunks.getMetadata);

  // Depots
  realmRouter.get("/:realmId/depots", deps.depots.list);
  realmRouter.post(
    "/:realmId/depots",
    deps.writeAccessMiddleware,
    zValidator("json", CreateDepotSchema),
    deps.depots.create
  );
  realmRouter.get("/:realmId/depots/:depotId", deps.depots.get);
  realmRouter.patch(
    "/:realmId/depots/:depotId",
    deps.writeAccessMiddleware,
    zValidator("json", UpdateDepotSchema),
    deps.depots.update
  );
  realmRouter.delete("/:realmId/depots/:depotId", deps.writeAccessMiddleware, deps.depots.delete);
  realmRouter.post(
    "/:realmId/depots/:depotId/commit",
    deps.writeAccessMiddleware,
    zValidator("json", CommitDepotSchema),
    deps.depots.commit
  );

  app.route("/api/realm", realmRouter);

  // ============================================================================
  // 404 Handler
  // ============================================================================

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
};
