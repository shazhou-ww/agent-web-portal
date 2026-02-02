/**
 * CASFA Context
 *
 * Provides CasfaClient and CasfaEndpoint instances for the WebUI.
 * Integrates with AuthContext to get user tokens.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  CasfaClient,
  CasfaEndpoint,
  IndexedDBStorageProvider,
  type TreeNodeInfo,
  type WriteResult,
  type DictEntry,
} from "@agent-web-portal/casfa-client-browser";
import { useAuth } from "./AuthContext";
import { API_URL } from "../utils/api";

// Re-export types for convenience
export type { TreeNodeInfo, WriteResult, DictEntry };

interface CasfaContextType {
  /** CasfaClient instance (null if not authenticated) */
  client: CasfaClient | null;
  /** CasfaEndpoint for current user's realm (null if not authenticated) */
  endpoint: CasfaEndpoint | null;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Refresh the endpoint (e.g., after token refresh) */
  refreshEndpoint: () => Promise<void>;
}

const CasfaContext = createContext<CasfaContextType | null>(null);

// Shared cache instance
let sharedCache: IndexedDBStorageProvider | null = null;

function getCache(): IndexedDBStorageProvider {
  if (!sharedCache) {
    sharedCache = new IndexedDBStorageProvider("casfa-webui-cache");
  }
  return sharedCache;
}

export function CasfaProvider({ children }: { children: ReactNode }) {
  const { getAccessToken, realm, user } = useAuth();
  const [client, setClient] = useState<CasfaClient | null>(null);
  const [endpoint, setEndpoint] = useState<CasfaEndpoint | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Build the base URL for CASFA API
  const baseUrl = useMemo(() => {
    const base = API_URL || window.location.origin;
    return base.replace(/\/$/, "");
  }, []);

  // Initialize client and endpoint when authenticated
  const initializeClient = useCallback(async () => {
    if (!user || !realm) {
      setClient(null);
      setEndpoint(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const token = await getAccessToken();
      if (!token) {
        setClient(null);
        setEndpoint(null);
        setError("Failed to get access token");
        return;
      }

      const cache = getCache();

      // Create CasfaClient (user token auth)
      const newClient = new CasfaClient({
        baseUrl,
        token,
        cache,
      });

      // Get endpoint for current user's realm
      const newEndpoint = await newClient.getEndpoint(realm);

      setClient(newClient);
      setEndpoint(newEndpoint);
    } catch (err) {
      console.error("Failed to initialize CASFA client:", err);
      setError(err instanceof Error ? err.message : "Failed to initialize CASFA client");
      setClient(null);
      setEndpoint(null);
    } finally {
      setLoading(false);
    }
  }, [user, realm, getAccessToken, baseUrl]);

  // Initialize on auth change
  useEffect(() => {
    initializeClient();
  }, [initializeClient]);

  // Refresh endpoint (e.g., after operations that might change state)
  const refreshEndpoint = useCallback(async () => {
    await initializeClient();
  }, [initializeClient]);

  const value = useMemo(
    () => ({
      client,
      endpoint,
      loading,
      error,
      refreshEndpoint,
    }),
    [client, endpoint, loading, error, refreshEndpoint]
  );

  return <CasfaContext.Provider value={value}>{children}</CasfaContext.Provider>;
}

export function useCasfa(): CasfaContextType {
  const context = useContext(CasfaContext);
  if (!context) {
    throw new Error("useCasfa must be used within a CasfaProvider");
  }
  return context;
}
