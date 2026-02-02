/**
 * Auth Controller
 *
 * Handles ticket creation, AWP client authorization, and Agent Token management.
 * Platform-agnostic - no HTTP concerns.
 */

import { generateVerificationCode } from "@agent-web-portal/auth";
import type {
  AuthContext,
  ControllerResult,
  Dependencies,
  ServerConfig,
} from "./types.ts";
import { ok, err } from "./types.ts";

// ============================================================================
// Request/Response Types
// ============================================================================

// AWP Client Init
export interface AwpClientInitRequest {
  pubkey: string;
  clientName: string;
}

export interface AwpClientInitResponse {
  authUrl: string;
  verificationCode: string;
  expiresIn: number;
  pollInterval: number;
}

// AWP Client Status
export interface AwpClientStatusResponse {
  authorized: boolean;
  expiresAt?: number;
  error?: string;
}

// AWP Client Complete
export interface AwpClientCompleteRequest {
  pubkey: string;
  verificationCode: string;
}

export interface AwpClientCompleteResponse {
  success: boolean;
  expiresAt: number;
}

// AWP Client List
export interface AwpClientInfo {
  pubkey: string;
  clientName: string;
  createdAt: string;
  expiresAt: string | null;
}

export interface ListAwpClientsResponse {
  clients: AwpClientInfo[];
}

// Ticket
export interface CreateTicketRequest {
  scope?: string[];
  commit?: { quota?: number; accept?: string[] };
  expiresIn?: number;
}

export interface CreateTicketResponse {
  id: string;
  endpoint: string;
  expiresAt: string;
  realm: string;
  scope?: string[];
  commit?: { quota?: number; accept?: string[] };
  config: {
    nodeLimit: number;
    maxNameBytes: number;
  };
}

// Agent Token
export interface CreateAgentTokenRequest {
  name: string;
  description?: string;
  expiresIn?: number;
}

export interface AgentTokenInfo {
  id: string;
  name: string;
  description?: string;
  expiresAt: string;
  createdAt: string;
}

export interface ListAgentTokensResponse {
  tokens: AgentTokenInfo[];
}

// ============================================================================
// Auth Controller
// ============================================================================

export class AuthController {
  constructor(private deps: Dependencies) {}

  // ==========================================================================
  // AWP Client Management
  // ==========================================================================

  /**
   * POST /auth/clients/init - Start AWP auth flow
   * No auth required
   */
  async initAwpClient(
    request: AwpClientInitRequest,
    baseUrl: string
  ): Promise<ControllerResult<AwpClientInitResponse>> {
    try {
      const verificationCode = generateVerificationCode();
      const now = Date.now();
      const expiresIn = 600; // 10 minutes

      await this.deps.pendingAuthStore.create({
        pubkey: request.pubkey,
        clientName: request.clientName,
        verificationCode,
        createdAt: now,
        expiresAt: now + expiresIn * 1000,
      });

      // Build auth URL (points to cas-webui)
      const authUrl = `${baseUrl}/auth/awp?pubkey=${encodeURIComponent(request.pubkey)}`;

      return ok({
        authUrl,
        verificationCode,
        expiresIn,
        pollInterval: 5,
      });
    } catch (error: any) {
      return err(500, error.message ?? "Failed to initiate auth");
    }
  }

  /**
   * GET /auth/clients/status - Poll for auth completion
   * No auth required
   */
  async getAwpClientStatus(
    pubkey: string
  ): Promise<ControllerResult<AwpClientStatusResponse>> {
    const authorized = await this.deps.pubkeyStore.lookup(pubkey);
    if (authorized) {
      return ok({
        authorized: true,
        expiresAt: authorized.expiresAt,
      });
    }

    // Check if pending auth exists
    const pending = await this.deps.pendingAuthStore.get(pubkey);
    if (!pending) {
      return ok({
        authorized: false,
        error: "No pending authorization found",
      });
    }

    return ok({ authorized: false });
  }

  /**
   * POST /auth/clients/complete - Complete authorization
   * Requires user auth
   */
  async completeAwpClient(
    auth: AuthContext,
    request: AwpClientCompleteRequest
  ): Promise<ControllerResult<AwpClientCompleteResponse>> {
    // Validate verification code
    const isValid = await this.deps.pendingAuthStore.validateCode(
      request.pubkey,
      request.verificationCode
    );
    if (!isValid) {
      return err(400, "Invalid or expired verification code");
    }

    // Get pending auth to retrieve client name
    const pending = await this.deps.pendingAuthStore.get(request.pubkey);
    if (!pending) {
      return err(400, "Pending authorization not found");
    }

    // Store authorized pubkey
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 days

    await this.deps.pubkeyStore.store({
      pubkey: request.pubkey,
      userId: auth.userId,
      clientName: pending.clientName,
      createdAt: now,
      expiresAt,
    });

    // Clean up pending auth
    await this.deps.pendingAuthStore.delete(request.pubkey);

    return ok({ success: true, expiresAt });
  }

  /**
   * GET /auth/clients - List authorized AWP clients
   * Requires user auth
   */
  async listAwpClients(
    auth: AuthContext
  ): Promise<ControllerResult<ListAwpClientsResponse>> {
    const clients = await this.deps.pubkeyStore.listByUser(auth.userId);
    return ok({
      clients: clients.map((c) => ({
        pubkey: c.pubkey,
        clientName: c.clientName,
        createdAt: new Date(c.createdAt).toISOString(),
        expiresAt: c.expiresAt ? new Date(c.expiresAt).toISOString() : null,
      })),
    });
  }

  /**
   * DELETE /auth/clients/:pubkey - Revoke AWP client
   * Requires user auth
   */
  async revokeAwpClient(
    auth: AuthContext,
    pubkey: string
  ): Promise<ControllerResult<{ success: boolean }>> {
    // Verify ownership
    const client = await this.deps.pubkeyStore.lookup(pubkey);
    if (!client || client.userId !== auth.userId) {
      return err(404, "Client not found or access denied");
    }

    await this.deps.pubkeyStore.revoke(pubkey);
    return ok({ success: true });
  }

  // ==========================================================================
  // Ticket Management
  // ==========================================================================

  /**
   * POST /auth/ticket - Create a ticket
   * Requires user/agent auth with canIssueTicket
   */
  async createTicket(
    auth: AuthContext,
    request: CreateTicketRequest
  ): Promise<ControllerResult<CreateTicketResponse>> {
    if (!auth.canIssueTicket) {
      return err(403, "Not authorized to issue tickets");
    }

    try {
      const ticket = await this.deps.tokensDb.createTicket(
        auth.realm,
        auth.tokenId,
        request.scope,
        request.commit,
        request.expiresIn
      );

      const ticketId = extractTokenId(ticket.pk);
      const endpoint = `${this.deps.serverConfig.baseUrl}/api/ticket/${ticketId}`;

      return ok({
        id: ticketId,
        endpoint,
        expiresAt: new Date(ticket.expiresAt).toISOString(),
        realm: ticket.realm,
        scope: ticket.scope,
        commit: ticket.commit,
        config: ticket.config,
      });
    } catch (error: any) {
      return err(403, error.message ?? "Cannot create ticket");
    }
  }

  /**
   * DELETE /auth/ticket/:id - Revoke a ticket
   * Requires user auth with ownership
   */
  async revokeTicket(
    auth: AuthContext,
    ticketId: string
  ): Promise<ControllerResult<{ success: boolean }>> {
    const isOwner = await this.deps.tokensDb.verifyTokenOwnership(
      ticketId,
      auth.userId
    );
    if (!isOwner) {
      return err(404, "Ticket not found");
    }

    await this.deps.tokensDb.deleteToken(ticketId);
    return ok({ success: true });
  }

  // ==========================================================================
  // Agent Token Management
  // ==========================================================================

  /**
   * POST /auth/tokens - Create an agent token
   * Requires user auth
   */
  async createAgentToken(
    auth: AuthContext,
    request: CreateAgentTokenRequest
  ): Promise<ControllerResult<AgentTokenInfo>> {
    try {
      const token = await this.deps.agentTokensDb.create(auth.userId, request.name, {
        description: request.description,
        expiresIn: request.expiresIn,
      });

      return ok({
        id: token.id,
        name: token.name,
        description: token.description,
        expiresAt: new Date(token.expiresAt).toISOString(),
        createdAt: new Date(token.createdAt).toISOString(),
      });
    } catch (error: any) {
      return err(403, error.message ?? "Cannot create agent token");
    }
  }

  /**
   * GET /auth/tokens - List agent tokens
   * Requires user auth
   */
  async listAgentTokens(
    auth: AuthContext
  ): Promise<ControllerResult<ListAgentTokensResponse>> {
    const tokens = await this.deps.agentTokensDb.listByUser(auth.userId);
    return ok({
      tokens: tokens.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description,
        expiresAt: new Date(t.expiresAt).toISOString(),
        createdAt: new Date(t.createdAt).toISOString(),
      })),
    });
  }

  /**
   * DELETE /auth/tokens/:id - Revoke an agent token
   * Requires user auth
   */
  async revokeAgentToken(
    auth: AuthContext,
    tokenId: string
  ): Promise<ControllerResult<{ success: boolean }>> {
    const success = await this.deps.agentTokensDb.revoke(auth.userId, tokenId);
    if (!success) {
      return err(404, "Agent token not found");
    }
    return ok({ success: true });
  }
}

// Helper function
function extractTokenId(pk: string): string {
  return pk.replace("token#", "");
}
