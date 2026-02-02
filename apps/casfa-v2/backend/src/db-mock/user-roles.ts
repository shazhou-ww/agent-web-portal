/**
 * In-memory implementation of UserRolesDb for testing
 */

import type { UserRole } from "../types.ts"
import type { UserRolesDb, UserRoleRecord } from "../db/user-roles.ts"

// ============================================================================
// Factory
// ============================================================================

export const createMemoryUserRolesDb = (): UserRolesDb & { _store: Map<string, UserRole>; _clear: () => void } => {
  const store = new Map<string, UserRole>()

  const getRole = async (userId: string): Promise<UserRole> => {
    return store.get(userId) ?? "unauthorized"
  }

  const setRole = async (userId: string, role: UserRole): Promise<void> => {
    store.set(userId, role)
  }

  const revoke = async (userId: string): Promise<void> => {
    store.delete(userId)
  }

  const listRoles = async (): Promise<UserRoleRecord[]> => {
    const roles: UserRoleRecord[] = []

    for (const [userId, role] of store.entries()) {
      roles.push({ userId, role })
    }

    return roles
  }

  return {
    getRole,
    setRole,
    revoke,
    listRoles,
    // Testing utilities
    _store: store,
    _clear: () => store.clear(),
  }
}
