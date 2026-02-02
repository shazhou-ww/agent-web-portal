/**
 * Commits Controller
 *
 * Handles commit listing, retrieval, and metadata updates.
 * Note: The actual commit creation (POST /commit) involves complex
 * reference counting and is handled separately.
 * Platform-agnostic - no HTTP concerns.
 */

import type { AuthContext, ControllerResult, Dependencies } from "./types.ts";
import { err, ok } from "./types.ts";

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CommitInfo {
  root: string;
  title?: string;
  createdAt: string;
  createdBy?: string;
}

export interface ListCommitsRequest {
  limit?: number;
  startKey?: string;
}

export interface ListCommitsResponse {
  commits: CommitInfo[];
  nextKey?: string;
}

export interface UpdateCommitRequest {
  title?: string;
}

// ============================================================================
// Commits Controller
// ============================================================================

export class CommitsController {
  constructor(private deps: Dependencies) {}

  /**
   * GET /commits - List commits for realm
   */
  async listCommits(
    auth: AuthContext,
    request: ListCommitsRequest
  ): Promise<ControllerResult<ListCommitsResponse>> {
    if (!auth.canRead) {
      return err(403, "Read access required");
    }

    const limit = Math.min(request.limit ?? 100, 1000);
    const result = await this.deps.commitsDb.listByScan(auth.realm, {
      limit,
      startKey: request.startKey,
    });

    return ok({
      commits: result.commits.map((c) => ({
        root: c.root,
        title: c.title,
        createdAt: new Date(c.createdAt).toISOString(),
      })),
      nextKey: result.nextKey,
    });
  }

  /**
   * GET /commits/:root - Get commit details
   */
  async getCommit(auth: AuthContext, root: string): Promise<ControllerResult<CommitInfo>> {
    if (!auth.canRead) {
      return err(403, "Read access required");
    }

    const commit = await this.deps.commitsDb.get(auth.realm, root);
    if (!commit) {
      return err(404, "Commit not found");
    }

    return ok({
      root: commit.root,
      title: commit.title,
      createdAt: new Date(commit.createdAt).toISOString(),
      createdBy: commit.createdBy,
    });
  }

  /**
   * PATCH /commits/:root - Update commit metadata
   */
  async updateCommit(
    auth: AuthContext,
    root: string,
    request: UpdateCommitRequest
  ): Promise<ControllerResult<CommitInfo>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    const commit = await this.deps.commitsDb.get(auth.realm, root);
    if (!commit) {
      return err(404, "Commit not found");
    }

    const updated = await this.deps.commitsDb.updateTitle(auth.realm, root, request.title);
    if (!updated) {
      return err(404, "Commit not found");
    }

    // Fetch updated commit
    const updatedCommit = await this.deps.commitsDb.get(auth.realm, root);

    return ok({
      root: updatedCommit!.root,
      title: updatedCommit!.title,
      createdAt: new Date(updatedCommit!.createdAt).toISOString(),
    });
  }

  /**
   * DELETE /commits/:root - Delete commit record
   * Note: This only deletes the commit record, not the underlying data.
   * Reference counting and GC are handled separately.
   */
  async deleteCommit(
    auth: AuthContext,
    root: string
  ): Promise<ControllerResult<{ success: boolean }>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Verify the commit exists
    const commit = await this.deps.commitsDb.get(auth.realm, root);
    if (!commit) {
      return err(404, "Commit not found");
    }

    // Delete the commit record
    const deleted = await this.deps.commitsDb.delete(auth.realm, root);
    if (!deleted) {
      return err(404, "Commit not found");
    }

    return ok({ success: true });
  }

  /**
   * POST /commit - Create a new commit
   * This is a simplified version for use with the memory storage.
   * The full version with reference counting is in the router.
   */
  async createCommit(
    auth: AuthContext,
    root: string,
    title?: string
  ): Promise<ControllerResult<{ success: boolean; root: string }>> {
    if (!auth.canWrite) {
      return err(403, "Write access required");
    }

    // Verify root exists in storage
    const rootExists = await this.deps.casStorage.exists(root);
    if (!rootExists) {
      return ok({
        success: false,
        root,
      });
    }

    // Verify ownership
    const hasOwnership = await this.deps.ownershipDb.hasOwnership(auth.realm, root);
    if (!hasOwnership) {
      return err(403, "Root node not owned by this realm");
    }

    // Record commit
    await this.deps.commitsDb.create(auth.realm, root, auth.tokenId, title);

    return ok({
      success: true,
      root,
    });
  }
}
