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

import {
  createWebCryptoHash,
  type HashProvider,
  type StorageProvider,
} from "@agent-web-portal/cas-core";

import { CasfaEndpoint } from "./endpoint.ts";
import type {
  CasfaSessionConfig,
  CreateDepotOptions,
  CreateTicketOptions,
  DepotHistoryEntry,
  DepotInfo,
  EndpointInfo,
  ListHistoryOptions,
  PaginatedResult,
  SessionAuth,
  TicketInfo,
  UpdateDepotOptions,
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
    this.hash = config.hash ?? createWebCryptoHash();
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
      hash: hash ?? createWebCryptoHash(),
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
  // Depot Management
  // ============================================================================

  /**
   * List all depots in a realm
   */
  async listDepots(realm: string, cursor?: string): Promise<PaginatedResult<DepotInfo>> {
    const params = new URLSearchParams();
    if (cursor) params.set("cursor", cursor);

    const url = `/cas/${realm}/depots${params.toString() ? `?${params}` : ""}`;
    const res = await this.fetch(url);

    if (!res.ok) {
      throw new Error(`Failed to list depots: ${res.status}`);
    }

    const data = (await res.json()) as { depots: DepotInfo[]; cursor?: string };
    return { items: data.depots, cursor: data.cursor };
  }

  /**
   * Create a new depot
   */
  async createDepot(realm: string, options: CreateDepotOptions): Promise<DepotInfo> {
    const res = await this.fetch(`/cas/${realm}/depots`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to create depot: ${res.status} - ${error}`);
    }

    return (await res.json()) as DepotInfo;
  }

  /**
   * Get a depot by ID
   */
  async getDepot(realm: string, depotId: string): Promise<DepotInfo> {
    const res = await this.fetch(`/cas/${realm}/depots/${depotId}`);

    if (!res.ok) {
      throw new Error(`Failed to get depot: ${res.status}`);
    }

    return (await res.json()) as DepotInfo;
  }

  /**
   * Get the main depot for a realm
   */
  async getMainDepot(realm: string): Promise<DepotInfo> {
    const result = await this.listDepots(realm);
    const mainDepot = result.items.find((d) => d.name === "main");

    if (!mainDepot) {
      throw new Error("Main depot not found");
    }

    return mainDepot;
  }

  /**
   * Update a depot's root
   */
  async updateDepot(
    realm: string,
    depotId: string,
    options: UpdateDepotOptions
  ): Promise<DepotInfo> {
    const res = await this.fetch(`/cas/${realm}/depots/${depotId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to update depot: ${res.status} - ${error}`);
    }

    return (await res.json()) as DepotInfo;
  }

  /**
   * Delete a depot
   */
  async deleteDepot(realm: string, depotId: string): Promise<void> {
    const res = await this.fetch(`/cas/${realm}/depots/${depotId}`, {
      method: "DELETE",
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to delete depot: ${res.status} - ${error}`);
    }
  }

  /**
   * Get depot history
   */
  async getDepotHistory(
    realm: string,
    depotId: string,
    options?: ListHistoryOptions
  ): Promise<PaginatedResult<DepotHistoryEntry>> {
    const params = new URLSearchParams();
    if (options?.limit) params.set("limit", String(options.limit));
    if (options?.cursor) params.set("cursor", options.cursor);

    const url = `/cas/${realm}/depots/${depotId}/history${params.toString() ? `?${params}` : ""}`;
    const res = await this.fetch(url);

    if (!res.ok) {
      throw new Error(`Failed to get depot history: ${res.status}`);
    }

    const data = (await res.json()) as { history: DepotHistoryEntry[]; cursor?: string };
    return { items: data.history, cursor: data.cursor };
  }

  /**
   * Rollback a depot to a previous version
   */
  async rollbackDepot(realm: string, depotId: string, version: number): Promise<DepotInfo> {
    const res = await this.fetch(`/cas/${realm}/depots/${depotId}/rollback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version }),
    });

    if (!res.ok) {
      const error = await res.text();
      throw new Error(`Failed to rollback depot: ${res.status} - ${error}`);
    }

    return (await res.json()) as DepotInfo;
  }

  // ============================================================================
  // HTTP Helpers
  // ============================================================================

  protected async fetch(path: string, init?: RequestInit): Promise<Response> {
    const url = `${this.baseUrl}${path}`;
    const headers = await this.getAuthHeaders(
      init?.method ?? "GET",
      url,
      init?.body as string | undefined
    );

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
