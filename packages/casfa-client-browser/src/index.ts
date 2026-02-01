/**
 * @aspect/casfa-client-browser
 *
 * Browser-specific CASFA client with IndexedDB caching
 */

// Re-export everything from core
export * from "@agent-web-portal/casfa-client";

// Browser-specific storage
export { IndexedDBStorageProvider } from "./storage.ts";

// Factory functions
import { CasfaClient, CasfaEndpoint, type CasfaClientConfig, type ClientAuth } from "@agent-web-portal/casfa-client";
import { IndexedDBStorageProvider } from "./storage.ts";

/**
 * Create a CasfaClient with IndexedDB caching
 */
export function createCasfaClient(
  baseUrl: string,
  auth: ClientAuth,
  options?: { dbName?: string }
): CasfaClient {
  const cache = new IndexedDBStorageProvider(options?.dbName);
  return new CasfaClient({
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
  return CasfaClient.fromTicket(baseUrl, ticketId, cache);
}
