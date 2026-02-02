/**
 * Depot Controller
 *
 * Handles depot CRUD operations and history management.
 * Platform-agnostic - no HTTP concerns.
 */

import type { AuthContext, ControllerResult, Dependencies } from "./types.ts";
import { EMPTY_COLLECTION_DATA, EMPTY_COLLECTION_KEY, err, ok } from "./types.ts";

// ============================================================================
// Request/Response Types
// ============================================================================

export interface DepotInfo {
  depotId: string;
  name: string;
  root: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  description?: string;
}

export interface ListDepotsRequest {
  limit?: number;
  cursor?: string;
}

export interface ListDepotsResponse {
  depots: DepotInfo[];
  cursor?: string;
}

export interface CreateDepotRequest {
  name: string;
  description?: string;
}

export interface UpdateDepotRequest {
  root: string;
  message?: string;
}

export interface RollbackDepotRequest {
  version: number;
}

export interface DepotHistoryEntry {
  version: number;
  root: string;
  createdAt: string;
  message?: string;
}

export interface ListDepotHistoryRequest {
  limit?: number;
  cursor?: string;
}

export interface ListDepotHistoryResponse {
  history: DepotHistoryEntry[];
  cursor?: string;
}

// Main depot name constant
const MAIN_DEPOT_NAME = "main";

// ============================================================================
// Depot Controller
// ============================================================================

export class DepotController {
  constructor(private deps: Dependencies) {}

  /**
   * Ensure the empty collection exists in storage
   */
  private async ensureEmptyCollection(realm: string, tokenId: string): Promise<void> {
    const exists = await this.deps.casStorage.exists(EMPTY_COLLECTION_KEY);
    if (!exists) {
      const result = await this.deps.casStorage.putWithKey(
        EMPTY_COLLECTION_KEY,
        EMPTY_COLLECTION_DATA,
        "application/vnd.cas.collection"
      );
      if ("error" in result) {
        throw new Error(
          `Empty collection hash mismatch: expected ${result.expected}, got ${result.actual}`
        );
      }
    }

    // Ensure ownership
    const hasOwnership = await this.deps.ownershipDb.hasOwnership(realm, EMPTY_COLLECTION_KEY);
    if (!hasOwnership) {
      await this.deps.ownershipDb.addOwnership(
        realm,
        EMPTY_COLLECTION_KEY,
        tokenId,
        "application/vnd.cas.collection",
        EMPTY_COLLECTION_DATA.length
      );
    }
  }

  /**
   * GET /depots - List all depots in realm
   */
  async listDepots(
    auth: AuthContext,
    request: ListDepotsRequest
  ): Promise<ControllerResult<ListDepotsResponse>> {
    if (!auth.canRead) {
      return err(403, "Read access required");
    }

    const result = await this.deps.depotDb.list(auth.realm, {
      limit: request.limit ?? 100,
      startKey: request.cursor,
    });

    return ok({
      depots: result.depots.map((d) => ({
        depotId: d.depotId,
        name: d.name,
        root: d.root,
        version: d.version,
        createdAt: new Date(d.createdAt).toISOString(),
        updatedAt: new Date(d.updatedAt).toISOString(),
        description: d.description,
      })),
      cursor: result.nextKey,
    });
  }

  /**
   * POST /depots - Create a new depot
   */
  async createDepot(
    auth: AuthContext,
    request: CreateDepotRequest
  ): Promise<ControllerResult<DepotInfo>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Check if depot with this name already exists
    const existing = await this.deps.depotDb.getByName(auth.realm, request.name);
    if (existing) {
      return err(409, `Depot with name '${request.name}' already exists`);
    }

    // Ensure empty collection exists
    await this.ensureEmptyCollection(auth.realm, auth.tokenId);

    // Create the depot
    const depot = await this.deps.depotDb.create(auth.realm, {
      name: request.name,
      root: EMPTY_COLLECTION_KEY,
      description: request.description,
    });

    return ok({
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  /**
   * GET /depots/:depotId - Get depot by ID
   */
  async getDepot(auth: AuthContext, depotId: string): Promise<ControllerResult<DepotInfo>> {
    if (!auth.canRead) {
      return err(403, "Read access required");
    }

    const depot = await this.deps.depotDb.get(auth.realm, depotId);
    if (!depot) {
      return err(404, "Depot not found");
    }

    return ok({
      depotId: depot.depotId,
      name: depot.name,
      root: depot.root,
      version: depot.version,
      createdAt: new Date(depot.createdAt).toISOString(),
      updatedAt: new Date(depot.updatedAt).toISOString(),
      description: depot.description,
    });
  }

  /**
   * PUT /depots/:depotId - Update depot root
   */
  async updateDepot(
    auth: AuthContext,
    depotId: string,
    request: UpdateDepotRequest
  ): Promise<ControllerResult<DepotInfo>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Get current depot
    const depot = await this.deps.depotDb.get(auth.realm, depotId);
    if (!depot) {
      return err(404, "Depot not found");
    }

    // Verify new root exists
    const exists = await this.deps.casStorage.exists(request.root);
    if (!exists) {
      return err(400, "New root node does not exist");
    }

    // Update depot
    const { depot: updatedDepot } = await this.deps.depotDb.updateRoot(
      auth.realm,
      depotId,
      request.root,
      request.message
    );

    return ok({
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }

  /**
   * DELETE /depots/:depotId - Delete a depot
   */
  async deleteDepot(
    auth: AuthContext,
    depotId: string
  ): Promise<ControllerResult<{ deleted: boolean }>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Get depot first
    const depot = await this.deps.depotDb.get(auth.realm, depotId);
    if (!depot) {
      return err(404, "Depot not found");
    }

    // Check if it's the main depot
    if (depot.name === MAIN_DEPOT_NAME) {
      return err(403, "Cannot delete the main depot");
    }

    // Delete the depot
    await this.deps.depotDb.delete(auth.realm, depotId);

    return ok({ deleted: true });
  }

  /**
   * GET /depots/:depotId/history - List depot history
   */
  async listDepotHistory(
    auth: AuthContext,
    depotId: string,
    request: ListDepotHistoryRequest
  ): Promise<ControllerResult<ListDepotHistoryResponse>> {
    if (!auth.canRead) {
      return err(403, "Read access required");
    }

    // Verify depot exists
    const depot = await this.deps.depotDb.get(auth.realm, depotId);
    if (!depot) {
      return err(404, "Depot not found");
    }

    const result = await this.deps.depotDb.listHistory(auth.realm, depotId, {
      limit: request.limit ?? 50,
      startKey: request.cursor,
    });

    return ok({
      history: result.history.map((h) => ({
        version: h.version,
        root: h.root,
        createdAt: new Date(h.createdAt).toISOString(),
        message: h.message,
      })),
      cursor: result.nextKey,
    });
  }

  /**
   * POST /depots/:depotId/rollback - Rollback to a previous version
   */
  async rollbackDepot(
    auth: AuthContext,
    depotId: string,
    request: RollbackDepotRequest
  ): Promise<ControllerResult<DepotInfo & { message?: string }>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Get current depot
    const depot = await this.deps.depotDb.get(auth.realm, depotId);
    if (!depot) {
      return err(404, "Depot not found");
    }

    // Get the history record for target version
    const historyRecord = await this.deps.depotDb.getHistory(auth.realm, depotId, request.version);
    if (!historyRecord) {
      return err(404, `Version ${request.version} not found`);
    }

    const oldRoot = depot.root;
    const newRoot = historyRecord.root;

    // Skip if already at this root
    if (oldRoot === newRoot) {
      return ok({
        depotId: depot.depotId,
        name: depot.name,
        root: depot.root,
        version: depot.version,
        createdAt: new Date(depot.createdAt).toISOString(),
        updatedAt: new Date(depot.updatedAt).toISOString(),
        description: depot.description,
        message: "Already at this version",
      });
    }

    // Verify target root still exists
    const exists = await this.deps.casStorage.exists(newRoot);
    if (!exists) {
      return err(500, "Target root node no longer exists");
    }

    // Update depot with rollback message
    const { depot: updatedDepot } = await this.deps.depotDb.updateRoot(
      auth.realm,
      depotId,
      newRoot,
      `Rollback to version ${request.version}`
    );

    return ok({
      depotId: updatedDepot.depotId,
      name: updatedDepot.name,
      root: updatedDepot.root,
      version: updatedDepot.version,
      createdAt: new Date(updatedDepot.createdAt).toISOString(),
      updatedAt: new Date(updatedDepot.updatedAt).toISOString(),
      description: updatedDepot.description,
    });
  }
}
