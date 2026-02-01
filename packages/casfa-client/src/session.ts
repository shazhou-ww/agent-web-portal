/**
 * CasfaSession - Base authentication session
 *
 * Provides authenticated access to CASFA service with three auth methods:
 * - User token (OAuth Bearer)
 * - Agent token
 * - P256 signature
 *
 * Capabilities:
 * - Get endpoints for realms
 * - Ticket management (create, list, revoke)
 */

import { WebCryptoHashProvider, type StorageProvider, type HashProvider } from "@agent-web-portal/cas-core";

import { CasfaEndpoint } from "./endpoint.ts";
import type {
  CasfaSessionConfig,
  SessionAuth,
  EndpointInfo,
  CreateTicketOptions,
  TicketInfo,
} from "./types.ts";

/**
 * CasfaSession - base authentication session for CASFA
 */
export class CasfaSession {
  protected baseUrl: string;
  protected auth: SessionAuth;
  protected cache?: StorageProvider;
  protected hash: HashProvider;

  constructor(config: CasfaSessionConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.auth = config.auth;
    this.cache = config.cache;
    this.hash = config.hash ?? new WebCryptoHashProvider();
  }

  // ============================================================================
  // Static Factory Methods
  // ============================================================================

  /**
   * Create an endpoint directly from a ticket ID (no session auth needed)
   */
  static async fromTicket(
    baseUrl: string,
    ticketId: string,
    cache?: StorageProvider,
    hash?: HashProvider
  ): Promise<CasfaEndpoint> {
    const normalizedUrl = baseUrl.replace(/\/$/, "");
    const url = `${normalizedUrl}/cas/${ticketId}`;

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
      auth: { type: "bearer", token: this.getBearerToken() },
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
   * List tickets
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
  // HTTP Helpers
  // ============================================================================

  protected async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = await this.getAuthHeaders(init?.method ?? "GET", url, init?.body as string | undefined);

    return fetch(url, {
      ...init,
      headers: {
        ...init?.headers,
        ...headers,
      },
    });
  }

  protected async getAuthHeaders(
    method: string,
    url: string,
    body?: string
  ): Promise<Record<string, string>> {
    switch (this.auth.type) {
      case "user":
        return { Authorization: `Bearer ${this.auth.token}` };
      case "agent":
        return { Authorization: `Agent ${this.auth.token}` };
      case "p256":
        return this.auth.sign(method, url, body);
    }
  }

  protected getBearerToken(): string {
    switch (this.auth.type) {
      case "user":
        return this.auth.token;
      case "agent":
        return this.auth.token;
      case "p256":
        // P256 auth doesn't have a bearer token, endpoints will need to use different auth
        throw new Error("P256 auth does not provide a bearer token for endpoints");
    }
  }
}
