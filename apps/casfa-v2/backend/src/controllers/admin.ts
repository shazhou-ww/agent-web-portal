/**
 * Admin controller
 */

import type { Context } from "hono";
import type { CognitoConfig } from "../config.ts";
import type { UserRolesDb } from "../db/user-roles.ts";
import type { Env, UserRole } from "../types.ts";

export type AdminController = {
  listUsers: (c: Context<Env>) => Promise<Response>;
  authorizeUser: (c: Context<Env>) => Promise<Response>;
  revokeUser: (c: Context<Env>) => Promise<Response>;
};

type AdminControllerDeps = {
  userRolesDb: UserRolesDb;
  cognitoConfig: CognitoConfig;
};

// Note: For production, you'd want to implement getCognitoUserMap
// to fetch user details from Cognito. For now, we just return basic info.
export const createAdminController = (deps: AdminControllerDeps): AdminController => {
  const { userRolesDb } = deps;

  return {
    listUsers: async (c) => {
      const list = await userRolesDb.listRoles();

      const users = list.map((u) => ({
        userId: u.userId,
        role: u.role,
        email: "", // Would be fetched from Cognito
        name: undefined,
      }));

      return c.json({ users });
    },

    authorizeUser: async (c) => {
      const targetUserId = decodeURIComponent(c.req.param("userId"));
      const body = await c.req.json();
      const role = body.role as UserRole;

      await userRolesDb.setRole(targetUserId, role);

      return c.json({ userId: targetUserId, role });
    },

    revokeUser: async (c) => {
      const targetUserId = decodeURIComponent(c.req.param("userId"));

      await userRolesDb.revoke(targetUserId);

      return c.json({ userId: targetUserId, revoked: true });
    },
  };
};
