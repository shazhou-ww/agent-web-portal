/**
 * CAS Context
 *
 * Provides CAS (Content-Addressable Storage) access throughout the app.
 * Used for rendering cas:// protocol images and other CAS content.
 */

import { createContext, useContext, useMemo, useRef, useCallback, type ReactNode } from "react";
import { CasClient, type LocalStorageProvider } from "@agent-web-portal/cas-client-browser";
import type { KeyStorage } from "@agent-web-portal/client";
import { AwpAuth } from "@agent-web-portal/client";

/** Cached content result */
interface CachedContent {
  data: Uint8Array;
  contentType: string;
}

/** In-flight request promise */
type InflightRequest = Promise<CachedContent | null>;

/**
 * CAS Context value
 */
interface CasContextValue {
  /** CAS endpoint URL */
  casEndpoint: string | null;
  /** Whether CAS is authenticated */
  isAuthenticated: boolean;
  /** Get a CAS client for accessing content */
  getCasClient: () => CasClient | null;
  /** Fetch CAS content by key (creates ticket, fetches data) */
  fetchCasContent: (key: string) => Promise<{ data: Uint8Array; contentType: string } | null>;
}

const CasContext = createContext<CasContextValue>({
  casEndpoint: null,
  isAuthenticated: false,
  getCasClient: () => null,
  fetchCasContent: async () => null,
});

export interface CasContextProviderProps {
  children: ReactNode;
  /** CAS endpoint URL */
  casEndpoint: string | null;
  /** Whether CAS is authenticated */
  isAuthenticated: boolean;
  /** Key storage for authentication */
  keyStorage: KeyStorage;
  /** Client name for auth */
  clientName: string;
  /** Local storage provider for caching (optional) */
  localStorage?: LocalStorageProvider;
}

/**
 * CasContextProvider component that provides CAS access to the app
 */
export function CasContextProvider({
  children,
  casEndpoint,
  isAuthenticated,
  keyStorage,
  clientName,
  localStorage,
}: CasContextProviderProps) {
  // Create auth instance
  const auth = useMemo(() => {
    return new AwpAuth({
      clientName,
      keyStorage,
    });
  }, [clientName, keyStorage]);

  // Cache for fetched content (persists across renders)
  const contentCacheRef = useRef<Map<string, CachedContent>>(new Map());
  // In-flight requests to deduplicate concurrent fetches
  const inflightRef = useRef<Map<string, InflightRequest>>(new Map());
  // Store refs for stable callback
  const authRef = useRef(auth);
  const casEndpointRef = useRef(casEndpoint);
  const isAuthenticatedRef = useRef(isAuthenticated);
  const localStorageRef = useRef(localStorage);

  // Update refs when values change
  authRef.current = auth;
  casEndpointRef.current = casEndpoint;
  isAuthenticatedRef.current = isAuthenticated;
  localStorageRef.current = localStorage;

  // Create a function to get CAS client
  const getCasClient = useMemo(() => {
    return (): CasClient | null => {
      if (!casEndpoint || !isAuthenticated) {
        return null;
      }

      // Create a new CasClient with user token auth
      // Note: For now we use a simple approach - the actual auth is done via signed requests
      return new CasClient({
        endpoint: casEndpoint,
        auth: { type: "user", token: "" }, // Will be overridden by signed requests
        storage: localStorage,
      });
    };
  }, [casEndpoint, isAuthenticated, localStorage]);

  // Fetch CAS content with caching and deduplication
  const fetchCasContent = useCallback(
    async (key: string): Promise<{ data: Uint8Array; contentType: string } | null> => {
      const endpoint = casEndpointRef.current;
      const authenticated = isAuthenticatedRef.current;

      if (!endpoint || !authenticated) {
        console.warn("[CasContext] Cannot fetch CAS content: not authenticated");
        return null;
      }

      // Check cache first
      const cached = contentCacheRef.current.get(key);
      if (cached) {
        console.log("[CasContext] Cache hit for:", key);
        return cached;
      }

      // Check if there's an in-flight request for this key
      const inflight = inflightRef.current.get(key);
      if (inflight) {
        console.log("[CasContext] Waiting for in-flight request:", key);
        return inflight;
      }

      // Create new request
      const requestPromise = (async (): Promise<CachedContent | null> => {
        try {
          // First, create a ticket for this specific key
          const ticketUrl = `${endpoint}/auth/ticket`;
          const ticketBody = JSON.stringify({
            scope: key,
            writable: false,
            expiresIn: 3600,
          });

          // Sign the ticket request
          const signedHeaders = await authRef.current.sign(endpoint, "POST", ticketUrl, ticketBody);

          const ticketRes = await fetch(ticketUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...signedHeaders,
            },
            body: ticketBody,
          });

          if (!ticketRes.ok) {
            console.error("[CasContext] Failed to create ticket:", ticketRes.status);
            return null;
          }

          const ticket = await ticketRes.json() as {
            id: string;
            realm: string;
            endpoint: string;
            config: { chunkThreshold: number };
          };

          console.log("[CasContext] Ticket created:", {
            id: ticket.id,
            realm: ticket.realm,
          });

          // Now use the ticket to fetch the content with realm from ticket
          const client = new CasClient({
            endpoint,
            auth: { type: "ticket", id: ticket.id },
            storage: localStorageRef.current,
            realm: ticket.realm,
          });

          // Open the file
          const handle = await client.openFile(key);
          const data = await handle.bytes();

          const result: CachedContent = {
            data,
            contentType: handle.contentType,
          };

          // Store in cache
          contentCacheRef.current.set(key, result);
          console.log("[CasContext] Cached content for:", key);

          return result;
        } catch (error) {
          console.error("[CasContext] Failed to fetch CAS content:", error);
          return null;
        } finally {
          // Remove from in-flight map
          inflightRef.current.delete(key);
        }
      })();

      // Store in in-flight map
      inflightRef.current.set(key, requestPromise);

      return requestPromise;
    },
    [] // No dependencies - uses refs for stability
  );

  const value = useMemo<CasContextValue>(() => ({
    casEndpoint,
    isAuthenticated,
    getCasClient,
    fetchCasContent,
  }), [casEndpoint, isAuthenticated, getCasClient, fetchCasContent]);

  return (
    <CasContext.Provider value={value}>
      {children}
    </CasContext.Provider>
  );
}

/**
 * Hook to access the CAS context
 */
export function useCas(): CasContextValue {
  return useContext(CasContext);
}

/**
 * Parse a cas:// URI to extract the key
 * @param uri - The CAS URI (e.g., "cas://sha256:abc123...")
 * @returns The CAS key (e.g., "sha256:abc123...") or null if invalid
 */
export function parseCasUri(uri: string): string | null {
  if (uri.startsWith("cas://")) {
    return uri.slice(6); // Remove "cas://" prefix
  }
  return null;
}

/**
 * Check if a URL is a CAS URI
 */
export function isCasUri(url: string): boolean {
  return url.startsWith("cas://");
}
