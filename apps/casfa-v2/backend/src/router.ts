/**
 * CASFA v2 - Hono Router
 */

import { zValidator } from "@hono/zod-validator";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { cors } from "hono/cors";
import type { AdminController } from "./controllers/admin.ts";
import type { AuthClientsController } from "./controllers/auth-clients.ts";
import type { AuthTicketsController } from "./controllers/auth-tickets.ts";
import type { AuthTokensController } from "./controllers/auth-tokens.ts";
import type { ChunksController } from "./controllers/chunks.ts";
import type { CommitsController } from "./controllers/commits.ts";
import type { DepotsController } from "./controllers/depots.ts";
import type { HealthController } from "./controllers/health.ts";
import type { OAuthController } from "./controllers/oauth.ts";
import type { RealmController } from "./controllers/realm.ts";
import type { TicketController } from "./controllers/ticket.ts";
import type { McpController } from "./mcp/handler.ts";
import {
  AuthorizeUserSchema,
  AwpAuthCompleteSchema,
  AwpAuthInitSchema,
  CommitSchema,
  CreateAgentTokenSchema,
  CreateDepotSchema,
  CreateTicketSchema,
  LoginSchema,
  RefreshSchema,
  RollbackDepotSchema,
  TokenExchangeSchema,
  UpdateCommitSchema,
  UpdateDepotSchema,
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
  authTickets: AuthTicketsController;
  authTokens: AuthTokensController;
  admin: AdminController;
  realm: RealmController;
  ticket: TicketController;
  commits: CommitsController;
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
  // Auth Routes - Tickets
  // ============================================================================

  app.post(
    "/api/auth/ticket",
    deps.authMiddleware,
    zValidator("json", CreateTicketSchema),
    deps.authTickets.create
  );
  app.delete("/api/auth/ticket/:id", deps.authMiddleware, deps.authTickets.revoke);

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
  app.post(
    "/api/admin/users/:userId/authorize",
    deps.authMiddleware,
    deps.adminAccessMiddleware,
    zValidator("json", AuthorizeUserSchema),
    deps.admin.authorizeUser
  );
  app.delete(
    "/api/admin/users/:userId/authorize",
    deps.authMiddleware,
    deps.adminAccessMiddleware,
    deps.admin.revokeUser
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

  // Commits
  realmRouter.get("/:realmId/commits", deps.commits.list);
  realmRouter.post(
    "/:realmId/commit",
    deps.writeAccessMiddleware,
    zValidator("json", CommitSchema),
    deps.commits.create
  );
  realmRouter.get("/:realmId/commits/:root", deps.commits.get);
  realmRouter.patch(
    "/:realmId/commits/:root",
    deps.writeAccessMiddleware,
    zValidator("json", UpdateCommitSchema),
    deps.commits.update
  );
  realmRouter.delete("/:realmId/commits/:root", deps.writeAccessMiddleware, deps.commits.delete);

  // Chunks
  realmRouter.put("/:realmId/chunks/:key", deps.writeAccessMiddleware, deps.chunks.put);
  realmRouter.get("/:realmId/chunks/:key", deps.chunks.get);
  realmRouter.get("/:realmId/tree/:key", deps.chunks.getTree);

  // Depots
  realmRouter.get("/:realmId/depots", deps.depots.list);
  realmRouter.post(
    "/:realmId/depots",
    deps.writeAccessMiddleware,
    zValidator("json", CreateDepotSchema),
    deps.depots.create
  );
  realmRouter.get("/:realmId/depots/:depotId", deps.depots.get);
  realmRouter.put(
    "/:realmId/depots/:depotId",
    deps.writeAccessMiddleware,
    zValidator("json", UpdateDepotSchema),
    deps.depots.update
  );
  realmRouter.delete("/:realmId/depots/:depotId", deps.writeAccessMiddleware, deps.depots.delete);
  realmRouter.get("/:realmId/depots/:depotId/history", deps.depots.history);
  realmRouter.post(
    "/:realmId/depots/:depotId/rollback",
    deps.writeAccessMiddleware,
    zValidator("json", RollbackDepotSchema),
    deps.depots.rollback
  );

  app.route("/api/realm", realmRouter);

  // ============================================================================
  // Ticket Routes
  // ============================================================================

  const ticketRouter = new Hono<Env>();

  // Ticket info (no auth needed - ticket ID is the credential)
  ticketRouter.get("/:ticketId", deps.ticket.getInfo);

  // Ticket operations (ticket auth)
  ticketRouter.use("/:ticketId/*", deps.ticketAuthMiddleware);
  ticketRouter.get("/:ticketId/usage", deps.ticket.getUsage);

  // Commits via ticket
  ticketRouter.get("/:ticketId/commits", deps.commits.list);
  ticketRouter.post(
    "/:ticketId/commit",
    deps.writeAccessMiddleware,
    zValidator("json", CommitSchema),
    deps.commits.create
  );
  ticketRouter.get("/:ticketId/commits/:root", deps.commits.get);
  ticketRouter.patch(
    "/:ticketId/commits/:root",
    deps.writeAccessMiddleware,
    zValidator("json", UpdateCommitSchema),
    deps.commits.update
  );
  ticketRouter.delete("/:ticketId/commits/:root", deps.writeAccessMiddleware, deps.commits.delete);

  // Chunks via ticket
  ticketRouter.put("/:ticketId/chunks/:key", deps.writeAccessMiddleware, deps.chunks.put);
  ticketRouter.get("/:ticketId/chunks/:key", deps.chunks.get);
  ticketRouter.get("/:ticketId/tree/:key", deps.chunks.getTree);

  // Note: Depot operations are NOT available via ticket routes

  app.route("/api/ticket", ticketRouter);

  // ============================================================================
  // 404 Handler
  // ============================================================================

  app.notFound((c) => c.json({ error: "Not found" }, 404));

  return app;
};
