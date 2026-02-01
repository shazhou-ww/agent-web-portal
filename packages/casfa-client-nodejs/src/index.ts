/**
 * @aspect/casfa-client-nodejs
 *
 * Node.js-specific CASFA client with file system caching
 */

// Re-export everything from core
export * from "@agent-web-portal/casfa-client";

// Node.js-specific storage
export { FileSystemStorageProvider } from "./storage.ts";

// Factory functions
import { CasfaClient, CasfaEndpoint, type ClientAuth } from "@agent-web-portal/casfa-client";
import { FileSystemStorageProvider } from "./storage.ts";

/**
 * Default cache directory
 */
function getDefaultCacheDir(): string {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "/tmp";
  return `${homeDir}/.casfa-cache`;
}

/**
 * Create a CasfaClient with file system caching
 */
export function createCasfaClient(
  baseUrl: string,
  auth: ClientAuth,
  options?: { cacheDir?: string }
): CasfaClient {
  const cache = new FileSystemStorageProvider(options?.cacheDir ?? getDefaultCacheDir());
  return new CasfaClient({
    baseUrl,
    auth,
    cache,
  });
}

/**
 * Create a CasfaEndpoint from a ticket with file system caching
 */
export async function createEndpointFromTicket(
  baseUrl: string,
  ticketId: string,
  options?: { cacheDir?: string }
): Promise<CasfaEndpoint> {
  const cache = new FileSystemStorageProvider(options?.cacheDir ?? getDefaultCacheDir());
  return CasfaClient.fromTicket(baseUrl, ticketId, cache);
}
