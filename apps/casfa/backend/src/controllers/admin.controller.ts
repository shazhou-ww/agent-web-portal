/**
 * Admin Controller
 *
 * Handles admin-only user management operations.
 * Platform-agnostic - no HTTP concerns.
 */

import type {
  AuthContext,
  ControllerResult,
  Dependencies,
  UserRole,
} from "./types.ts";
import { ok, err } from "./types.ts";

// ============================================================================
// Request/Response Types
// ============================================================================

export interface UserInfo {
  userId: string;
  role: UserRole;
  email: string;
  name?: string;
}

export interface ListUsersResponse {
  users: UserInfo[];
}

export interface AuthorizeUserRequest {
  role: UserRole;
}

export interface AuthorizeUserResponse {
  userId: string;
  role: UserRole;
}

export interface RevokeUserResponse {
  userId: string;
  revoked: boolean;
}

// ============================================================================
// Admin Controller
// ============================================================================

export class AdminController {
  constructor(
    private deps: Dependencies,
    private getCognitoUserMap?: (
      userPoolId: string,
      region: string
    ) => Promise<Map<string, { email?: string; name?: string }>>
  ) { }

  /**
   * GET /admin/users - List all users with roles
   * Requires admin auth
   */
  async listUsers(
    auth: AuthContext
  ): Promise<ControllerResult<ListUsersResponse>> {
    if (!auth.canManageUsers) {
      return err(403, "Admin access required");
    }

    if (!this.deps.userRolesDb) {
      return ok({ users: [] });
    }

    const list = await this.deps.userRolesDb.listRoles();

    // Enrich with Cognito user info if available
    let cognitoMap = new Map<string, { email?: string; name?: string }>();
    if (this.getCognitoUserMap && this.deps.cognitoConfig) {
      cognitoMap = await this.getCognitoUserMap(
        this.deps.cognitoConfig.userPoolId,
        this.deps.cognitoConfig.region
      );
    }

    const users = list.map((u) => {
      const attrs = cognitoMap.get(u.userId);
      return {
        userId: u.userId,
        role: u.role,
        email: attrs?.email ?? "",
        name: attrs?.name,
      };
    });

    return ok({ users });
  }

  /**
   * POST /admin/users/:userId/authorize - Set user role
   * Requires admin auth
   */
  async authorizeUser(
    auth: AuthContext,
    targetUserId: string,
    request: AuthorizeUserRequest
  ): Promise<ControllerResult<AuthorizeUserResponse>> {
    if (!auth.canManageUsers) {
      return err(403, "Admin access required");
    }

    if (!this.deps.userRolesDb) {
      return err(503, "User role management requires DynamoDB");
    }

    await this.deps.userRolesDb.setRole(targetUserId, request.role);
    return ok({ userId: targetUserId, role: request.role });
  }

  /**
   * DELETE /admin/users/:userId/authorize - Revoke user
   * Requires admin auth
   */
  async revokeUser(
    auth: AuthContext,
    targetUserId: string
  ): Promise<ControllerResult<RevokeUserResponse>> {
    if (!auth.canManageUsers) {
      return err(403, "Admin access required");
    }

    if (!this.deps.userRolesDb) {
      return err(503, "User role management requires DynamoDB");
    }

    await this.deps.userRolesDb.revoke(targetUserId);
    return ok({ userId: targetUserId, revoked: true });
  }
}
