/**
 * Mock AuthService for testing
 *
 * Provides a mock implementation of AuthService that works with in-memory databases.
 */

import type { AuthService, LoginResult, RefreshResult } from "../services/auth.ts"
import type { TokensDb } from "../db/tokens.ts"
import type { UserRolesDb } from "../db/user-roles.ts"
import type { Result } from "../util/result.ts"
import { ok, err } from "../util/result.ts"
import { extractTokenId } from "../util/token-id.ts"

// ============================================================================
// Types
// ============================================================================

export type MockUser = {
  id: string
  email: string
  password: string
  name?: string
}

export type MockAuthServiceOptions = {
  tokensDb: TokensDb
  userRolesDb: UserRolesDb
  /**
   * Predefined users for testing
   */
  users?: MockUser[]
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a mock AuthService for testing.
 *
 * This implementation:
 * - Uses in-memory user list instead of Cognito
 * - Creates real tokens in the provided TokensDb
 * - Supports adding test users dynamically
 */
export const createMockAuthService = (options: MockAuthServiceOptions): AuthService & {
  /**
   * Add a test user that can login
   */
  addUser: (user: MockUser) => void
  /**
   * Get all registered mock users
   */
  getUsers: () => MockUser[]
} => {
  const { tokensDb, userRolesDb, users = [] } = options
  const mockUsers = new Map<string, MockUser>()

  // Initialize with provided users
  for (const user of users) {
    mockUsers.set(user.email, user)
  }

  const addUser = (user: MockUser) => {
    mockUsers.set(user.email, user)
  }

  const getUsers = (): MockUser[] => {
    return Array.from(mockUsers.values())
  }

  const login = async (email: string, password: string): Promise<Result<LoginResult>> => {
    const user = mockUsers.get(email)

    if (!user) {
      return err("User not found")
    }

    if (user.password !== password) {
      return err("Invalid password")
    }

    // Create a real token in the database
    const token = await tokensDb.createUserToken(user.id, `mock-refresh-${user.id}`, 3600)
    const tokenId = extractTokenId(token.pk)

    // Get role
    const role = await userRolesDb.getRole(user.id)

    return ok({
      userToken: tokenId,
      refreshToken: `mock-refresh-${user.id}`,
      expiresAt: new Date(token.expiresAt).toISOString(),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      role,
    })
  }

  const refresh = async (refreshToken: string): Promise<Result<RefreshResult>> => {
    // Extract user ID from mock refresh token
    const match = refreshToken.match(/^mock-refresh-(.+)$/)
    if (!match || !match[1]) {
      return err("Invalid refresh token")
    }

    const userId = match[1]

    // Find user by ID
    let foundUser: MockUser | undefined
    for (const user of mockUsers.values()) {
      if (user.id === userId) {
        foundUser = user
        break
      }
    }

    if (!foundUser) {
      return err("User not found")
    }

    // Create new token
    const token = await tokensDb.createUserToken(userId, refreshToken, 3600)
    const tokenId = extractTokenId(token.pk)

    // Get role
    const role = await userRolesDb.getRole(userId)

    return ok({
      userToken: tokenId,
      expiresAt: new Date(token.expiresAt).toISOString(),
      role,
    })
  }

  return {
    login,
    refresh,
    addUser,
    getUsers,
  }
}
