/**
 * CasfaClient - Full CASFA service client
 *
 * Provides complete access to CASFA service including:
 * - Endpoint management (get endpoints for different realms)
 * - Ticket management (create, list, revoke)
 * - User profile and usage information
 * - Admin API (for admin authentication)
 */

import { WebCryptoHashProvider, type StorageProvider, type HashProvider } from "@agent-web-portal/cas-core";

import { CasfaEndpoint } from "./endpoint.ts";
import type {
  CasfaClientConfig,
  ClientAuth,
  EndpointInfo,
  CreateTicketOptions,
  TicketInfo,
  UserProfile,
  UsageInfo,
  QuotaConfig,
  UserInfo,
} from "./types.ts";

/**
 * CasfaClient - full CASFA service client
 */
export class CasfaClient {
  private baseUrl: string;
  private auth: ClientAuth;
  private cache?: StorageProvider;
  private hash: HashProvider;

  constructor(config: CasfaClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.auth = config.auth;
    this.cache = config.cache;
    this.hash = config.hash ?? new WebCryptoHashProvider();
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create an endpoint from a ticket ID (no full client auth needed)
   */
  static async fromTicket(
    baseUrl: string,
    ticketId: string,
    cache?: StorageProvider,
    hash?: HashProvider
  ): Promise<CasfaEndpoint> {
    const url = `${baseUrl.replace(/\/$/, "")}/cas/${ticketId}`;

    // Fetch endpoint info
    const res = await fetch(url, {
      headers: { Authorization: `Ticket ${ticketId}` },
    });

    if (!res.ok) {
      throw new Error(`Failed to get ticket endpoint: ${res.status}`);
    }

    const info = (await res.json()) as EndpointInfo;

    return new CasfaEndpoint({
      url,
      auth: { type: "ticket", id: ticketId },
      cache,
      hash: hash ?? new WebCryptoHashProvider(),
      info,
    });
  }

  // ============================================================================
  // Endpoint Access
  // ============================================================================

  /**
   * Get the current user's CAS endpoint (@me)
   */
  async getMyEndpoint(): Promise<CasfaEndpoint> {
    return this.getEndpoint("@me");
  }

  /**
   * Get a CAS endpoint for a specific realm
   */
  async getEndpoint(realm: string): Promise<CasfaEndpoint> {
    const url = `${this.baseUrl}/cas/${realm}`;

    // Fetch endpoint info
    const res = await this.fetch(`/cas/${realm}`);
    if (!res.ok) {
      throw new Error(`Failed to get endpoint: ${res.status}`);
    }

    const info = (await res.json()) as EndpointInfo;

    return new CasfaEndpoint({
      url,
      auth: { type: "bearer", token: this.getToken() },
      cache: this.cache,
      hash: this.hash,
      info,
    });
  }

  // ============================================================================
  // Ticket Management
  // ============================================================================

  /**
   * Create a new ticket
   */
  async createTicket(options: CreateTicketOptions = {}): Promise<TicketInfo> {
    const res = await this.fetch("/tickets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        realm: options.realm,
        scope: options.scope,
        commit: options.commit,
        expiresIn: options.expiresIn,
        label: options.label,
      }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create ticket: ${res.status} - ${error}`);
    }

    return (await res.json()) as TicketInfo;
  }

  /**
   * List all tickets for the current user
   */
  async listTickets(): Promise<TicketInfo[]> {
    const res = await this.fetch("/tickets");
    if (!res.ok) {
      throw new Error(`Failed to list tickets: ${res.status}`);
    }

    const data = (await res.json()) as { tickets: TicketInfo[] };
    return data.tickets;
  }

  /**
   * Get a specific ticket
   */
  async getTicket(ticketId: string): Promise<TicketInfo> {
    const res = await this.fetch(`/tickets/${ticketId}`);
    if (!res.ok) {
      throw new Error(`Failed to get ticket: ${res.status}`);
    }

    return (await res.json()) as TicketInfo;
  }

  /**
   * Revoke a ticket
   */
  async revokeTicket(ticketId: string): Promise<void> {
    const res = await this.fetch(`/tickets/${ticketId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to revoke ticket: ${res.status} - ${error}`);
    }
  }

  // ============================================================================
  // User Information
  // ============================================================================

  /**
   * Get current user's profile
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
  // Admin API (requires admin auth)
  // ============================================================================

  /**
   * List all users (admin only)
   */
  async listUsers(): Promise<UserInfo[]> {
    this.requireAdmin();

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
    this.requireAdmin();

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
    this.requireAdmin();

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

  // ============================================================================
  // HTTP Helpers
  // ============================================================================

  private async fetch(path: string, init?: RequestInit): Promise<Response> {
    return fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        ...init?.headers,
        Authorization: this.getAuthHeader(),
      },
    });
  }

  private getAuthHeader(): string {
    switch (this.auth.type) {
      case "user":
        return `Bearer ${this.auth.token}`;
      case "agent":
        return `Agent ${this.auth.token}`;
      case "admin":
        return `Admin ${this.auth.token}`;
    }
  }

  private getToken(): string {
    return this.auth.token;
  }

  private requireAdmin(): void {
    if (this.auth.type !== "admin") {
      throw new Error("Admin authentication required");
    }
  }
}
