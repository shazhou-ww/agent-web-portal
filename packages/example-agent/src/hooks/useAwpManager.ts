/**
 * useAwpManager Hook
 *
 * Manages AWP endpoints and provides access to skills/tools
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { AwpManager, type PrefixedTool, type RegisteredEndpoint, type SkillInfo } from "../core";

/**
 * Stored endpoint for persistence
 */
interface StoredEndpoint {
  url: string;
  alias?: string;
}

const ENDPOINTS_STORAGE_KEY = "awp-agent-endpoints";

export interface UseAwpManagerResult {
  /** AWP Manager instance */
  manager: AwpManager;
  /** Registered endpoints */
  endpoints: RegisteredEndpoint[];
  /** All available skills */
  skills: SkillInfo[];
  /** All available tools */
  tools: PrefixedTool[];
  /** Loading state */
  isLoading: boolean;
  /** Register a new endpoint */
  registerEndpoint: (url: string, alias?: string) => Promise<RegisteredEndpoint>;
  /** Unregister an endpoint */
  unregisterEndpoint: (endpointId: string) => void;
  /** Refresh skills and tools */
  refresh: () => Promise<void>;
  /** Update auth status for an endpoint */
  updateAuthStatus: (endpointId: string) => Promise<boolean>;
}

export function useAwpManager(): UseAwpManagerResult {
  const manager = useMemo(() => new AwpManager({ clientName: "AWP Agent" }), []);

  const [endpoints, setEndpoints] = useState<RegisteredEndpoint[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [tools, setTools] = useState<PrefixedTool[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load stored endpoints on mount
  useEffect(() => {
    const loadStoredEndpoints = async () => {
      setIsLoading(true);
      try {
        const stored = localStorage.getItem(ENDPOINTS_STORAGE_KEY);
        if (stored) {
          const storedEndpoints: StoredEndpoint[] = JSON.parse(stored);
          for (const ep of storedEndpoints) {
            await manager.registerEndpoint(ep.url, ep.alias);
          }
        }
        setEndpoints(manager.getEndpoints());
      } catch (error) {
        console.error("Failed to load stored endpoints:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadStoredEndpoints();
  }, [manager]);

  // Save endpoints to localStorage whenever they change
  const saveEndpoints = useCallback((eps: RegisteredEndpoint[]) => {
    const toStore: StoredEndpoint[] = eps.map((ep) => ({
      url: ep.url,
      alias: ep.alias,
    }));
    localStorage.setItem(ENDPOINTS_STORAGE_KEY, JSON.stringify(toStore));
  }, []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    try {
      const [newSkills, newTools] = await Promise.all([
        manager.listAllSkills(),
        manager.listAllTools(),
      ]);
      setSkills(newSkills);
      setTools(newTools);
    } catch (error) {
      console.error("Failed to refresh skills/tools:", error);
    } finally {
      setIsLoading(false);
    }
  }, [manager]);

  // Refresh when endpoints change
  useEffect(() => {
    if (endpoints.length > 0) {
      refresh();
    } else {
      setSkills([]);
      setTools([]);
    }
  }, [endpoints, refresh]);

  const registerEndpoint = useCallback(
    async (url: string, alias?: string): Promise<RegisteredEndpoint> => {
      const registered = await manager.registerEndpoint(url, alias);
      const newEndpoints = manager.getEndpoints();
      setEndpoints(newEndpoints);
      saveEndpoints(newEndpoints);
      return registered;
    },
    [manager, saveEndpoints]
  );

  const unregisterEndpoint = useCallback(
    (endpointId: string) => {
      manager.unregisterEndpoint(endpointId);
      const newEndpoints = manager.getEndpoints();
      setEndpoints(newEndpoints);
      saveEndpoints(newEndpoints);
    },
    [manager, saveEndpoints]
  );

  const updateAuthStatus = useCallback(
    async (endpointId: string): Promise<boolean> => {
      const result = await manager.updateAuthStatus(endpointId);
      setEndpoints([...manager.getEndpoints()]);
      return result;
    },
    [manager]
  );

  return {
    manager,
    endpoints,
    skills,
    tools,
    isLoading,
    registerEndpoint,
    unregisterEndpoint,
    refresh,
    updateAuthStatus,
  };
}
