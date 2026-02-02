/**
 * Controller Factory
 *
 * Factory functions to create controller instances with dependencies.
 * Simplifies integration with server.ts and router.ts.
 */

import type {
  CasStorageInterface,
  IAgentTokensDb,
  ICommitsDb,
  IDagDb,
  IDepotDb,
  IOwnershipDb,
  IPendingAuthStore,
  IPubkeyStore,
  ITokensDb,
} from "../db/memory/types.ts";
import { AdminController } from "./admin.controller.ts";
import { AuthController } from "./auth.controller.ts";
import { CommitsController } from "./commits.controller.ts";
import { DepotController } from "./depot.controller.ts";
import { OAuthController } from "./oauth.controller.ts";
import type { CognitoConfig, Dependencies, IUserRolesDb, ServerConfig } from "./types.ts";

// ============================================================================
// Dependencies Builder
// ============================================================================

export interface DependenciesBuilder {
  tokensDb: ITokensDb;
  ownershipDb: IOwnershipDb;
  dagDb: IDagDb;
  commitsDb: ICommitsDb;
  depotDb: IDepotDb;
  casStorage: CasStorageInterface;
  agentTokensDb: IAgentTokensDb;
  pendingAuthStore: IPendingAuthStore;
  pubkeyStore: IPubkeyStore;
  userRolesDb?: IUserRolesDb;
  serverConfig: ServerConfig;
  cognitoConfig?: CognitoConfig;
}

/**
 * Build Dependencies from builder object
 */
export function buildDependencies(builder: DependenciesBuilder): Dependencies {
  return builder;
}

// ============================================================================
// Controller Factory
// ============================================================================

export interface Controllers {
  auth: AuthController;
  oauth: OAuthController;
  admin: AdminController;
  commits: CommitsController;
  depot: DepotController;
}

export interface ControllerServices {
  authService?: {
    login(req: { email: string; password: string }): Promise<unknown>;
    refresh(req: { refreshToken: string }): Promise<unknown>;
  };
  getCognitoUserMap?: (
    userPoolId: string,
    region: string
  ) => Promise<Map<string, { email?: string; name?: string }>>;
}

/**
 * Create all controllers with shared dependencies
 */
export function createControllers(deps: Dependencies, services?: ControllerServices): Controllers {
  return {
    auth: new AuthController(deps),
    oauth: new OAuthController(deps, services?.authService),
    admin: new AdminController(deps, services?.getCognitoUserMap),
    commits: new CommitsController(deps),
    depot: new DepotController(deps),
  };
}
