/**
 * CasfaClient - Full CASFA user client
 *
 * Extends CasfaSession with user-only features:
 * - User profile and usage information
 * - Agent token management
 * - OAuth client management
 * - Admin API (if user has admin role)
 *
 * Only accepts user token (OAuth Bearer) authentication.
 */

import { createWebCryptoHash } from "@agent-web-portal/cas-core";

import { CasfaSession } from "./session.ts";
import type {
  AgentTokenInfo,
  CasfaClientConfig,
  ClientInfo,
  CreateAgentTokenOptions,
  CreateClientOptions,
  QuotaConfig,
  UpdateClientOptions,
  UsageInfo,
  UserInfo,
  UserProfile,
} from "./types.ts";

/**
 * CasfaClient - full CASFA user client
 *
 * Extends CasfaSession with user-only capabilities.
 * Only accepts user token authentication.
 */
export class CasfaClient extends CasfaSession {
  constructor(config: CasfaClientConfig) {
    super({
      baseUrl: config.baseUrl,
      auth: { type: "user", token: config.token },
      cache: config.cache,
      hash: config.hash ?? createWebCryptoHash(),
    });
  }

  // ============================================================================
  // User Profile
  // ============================================================================

  /**
   * Get current user's profile
   * Returns realm, isAdmin, email, quota, usage
   */
  async getProfile(): Promise<UserProfile> {
    const res = await this.fetch("/profile");
    if (!res.ok) {
      throw new Error(`Failed to get profile: ${res.status}`);
    }

    return (await res.json()) as UserProfile;
  }

  /**
   * Get current user's storage usage
   */
  async getUsage(): Promise<UsageInfo> {
    const res = await this.fetch("/usage");
    if (!res.ok) {
      throw new Error(`Failed to get usage: ${res.status}`);
    }

    return (await res.json()) as UsageInfo;
  }

  // ============================================================================
  // Agent Token Management
  // ============================================================================

  /**
   * Create a new agent token
   */
  async createAgentToken(options: CreateAgentTokenOptions): Promise<AgentTokenInfo> {
    const res = await this.fetch("/auth/tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create agent token: ${res.status} - ${error}`);
    }

    return (await res.json()) as AgentTokenInfo;
  }

  /**
   * List agent tokens
   */
  async listAgentTokens(): Promise<AgentTokenInfo[]> {
    const res = await this.fetch("/auth/tokens");
    if (!res.ok) {
      throw new Error(`Failed to list agent tokens: ${res.status}`);
    }

    const data = (await res.json()) as { tokens: AgentTokenInfo[] };
    return data.tokens;
  }

  /**
   * Revoke an agent token
   */
  async revokeAgentToken(tokenId: string): Promise<void> {
    const res = await this.fetch(`/auth/tokens/${tokenId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to revoke agent token: ${res.status} - ${error}`);
    }
  }

  // ============================================================================
  // OAuth Client Management
  // ============================================================================

  /**
   * Create a new OAuth client
   */
  async createClient(options: CreateClientOptions): Promise<ClientInfo> {
    const res = await this.fetch("/auth/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create client: ${res.status} - ${error}`);
    }

    return (await res.json()) as ClientInfo;
  }

  /**
   * List OAuth clients
   */
  async listClients(): Promise<ClientInfo[]> {
    const res = await this.fetch("/auth/clients");
    if (!res.ok) {
      throw new Error(`Failed to list clients: ${res.status}`);
    }

    const data = (await res.json()) as { clients: ClientInfo[] };
    return data.clients;
  }

  /**
   * Update an OAuth client
   */
  async updateClient(clientId: string, options: UpdateClientOptions): Promise<ClientInfo> {
    const res = await this.fetch(`/auth/clients/${clientId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to update client: ${res.status} - ${error}`);
    }

    return (await res.json()) as ClientInfo;
  }

  /**
   * Delete an OAuth client
   */
  async deleteClient(clientId: string): Promise<void> {
    const res = await this.fetch(`/auth/clients/${clientId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to delete client: ${res.status} - ${error}`);
    }
  }

  // ============================================================================
  // Admin API (requires isAdmin from profile)
  // ============================================================================

  /**
   * List all users (admin only)
   */
  async listUsers(): Promise<UserInfo[]> {
    const res = await this.fetch("/admin/users");
    if (!res.ok) {
      throw new Error(`Failed to list users: ${res.status}`);
    }

    const data = (await res.json()) as { users: UserInfo[] };
    return data.users;
  }

  /**
   * Get a specific user (admin only)
   */
  async getUser(userId: string): Promise<UserInfo> {
    const res = await this.fetch(`/admin/users/${userId}`);
    if (!res.ok) {
      throw new Error(`Failed to get user: ${res.status}`);
    }

    return (await res.json()) as UserInfo;
  }

  /**
   * Set user quota (admin only)
   */
  async setUserQuota(userId: string, quota: QuotaConfig): Promise<void> {
    const res = await this.fetch(`/admin/users/${userId}/quota`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(quota),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to set quota: ${res.status} - ${error}`);
    }
  }
}
