/**
 * @agent-web-portal/casfa-client-browser
 *
 * Browser-specific CASFA client with IndexedDB caching
 */

// Re-export everything from core
export * from "@agent-web-portal/casfa-client";

// Browser-specific storage
export { IndexedDBStorageProvider } from "./storage.ts";

// Factory functions
import {
  CasfaClient,
  type CasfaEndpoint,
  CasfaSession,
  type SessionAuth,
} from "@agent-web-portal/casfa-client";
import { IndexedDBStorageProvider } from "./storage.ts";

/**
 * Create a CasfaClient (user auth) with IndexedDB caching
 */
export function createCasfaClient(
  baseUrl: string,
  token: string,
  options?: { dbName?: string }
): CasfaClient {
  const cache = new IndexedDBStorageProvider(options?.dbName);
  return new CasfaClient({
    baseUrl,
    token,
    cache,
  });
}

/**
 * Create a CasfaSession with IndexedDB caching
 * Supports user, agent, or p256 authentication
 */
export function createCasfaSession(
  baseUrl: string,
  auth: SessionAuth,
  options?: { dbName?: string }
): CasfaSession {
  const cache = new IndexedDBStorageProvider(options?.dbName);
  return new CasfaSession({
    baseUrl,
    auth,
    cache,
  });
}

/**
 * Create a CasfaEndpoint from a ticket with IndexedDB caching
 */
export async function createEndpointFromTicket(
  baseUrl: string,
  ticketId: string,
  options?: { dbName?: string }
): Promise<CasfaEndpoint> {
  const cache = new IndexedDBStorageProvider(options?.dbName);
  return CasfaSession.fromTicket(baseUrl, ticketId, cache);
}
