/**
 * VirtualFS - Virtual filesystem operations on CAS dicts
 *
 * Provides path-based operations (read, write, delete, move, mount) on a
 * CAS dict tree. All changes are buffered in memory until build()
 * is called to generate the new root key.
 */

import { hashToKey } from "@agent-web-portal/cas-core";

import type { CasfaEndpoint } from "./endpoint.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Entry representing an existing CAS node
 */
interface NodeEntry {
  type: "node";
  key: string;
  /** Cached node info for dicts */
  children?: Map<string, VfsEntry>;
}

/**
 * Entry representing pending file data to be uploaded
 */
interface PendingEntry {
  type: "pending";
  data: Uint8Array;
  contentType: string;
}

/**
 * Entry representing a directory (dict)
 */
interface DirEntry {
  type: "dir";
  children: Map<string, VfsEntry>;
}

/**
 * VFS entry can be a node reference, pending data, or directory
 */
type VfsEntry = NodeEntry | PendingEntry | DirEntry;

/**
 * Options for writeFile
 */
export interface WriteFileOptions {
  contentType?: string;
}

/**
 * File info returned by stat
 */
export interface FileInfo {
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  key?: string; // Only available for existing nodes
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Normalize a path to consistent format
 */
function normalizePath(path: string): string {
  // Remove leading/trailing slashes and split
  const segments = path.split("/").filter((s) => s && s !== ".");
  return segments.join("/");
}

/**
 * Split path into parent and name
 */
function splitPath(path: string): { parent: string; name: string } {
  const normalized = normalizePath(path);
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash === -1) {
    return { parent: "", name: normalized };
  }
  return {
    parent: normalized.slice(0, lastSlash),
    name: normalized.slice(lastSlash + 1),
  };
}

/**
 * Get path segments
 */
function getSegments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

// ============================================================================
// VirtualFS Class
// ============================================================================

/**
 * Virtual filesystem for editing CAS dicts
 */
export class VirtualFS {
  private endpoint: CasfaEndpoint;
  private root: VfsEntry;
  private modified: boolean = false;

  private constructor(endpoint: CasfaEndpoint, root: VfsEntry) {
    this.endpoint = endpoint;
    this.root = root;
  }

  /**
   * Create a VirtualFS from an existing dict
   */
  static async fromDict(endpoint: CasfaEndpoint, rootKey: string): Promise<VirtualFS> {
    // Load the root node to verify it's a dict
    const node = await endpoint.getNode(rootKey);
    if (node.kind !== "dict") {
      throw new Error("Root must be a dict node");
    }

    // Create root entry with lazy-loaded children
    const root: NodeEntry = {
      type: "node",
      key: rootKey,
    };

    return new VirtualFS(endpoint, root);
  }

  /**
   * Create an empty VirtualFS
   */
  static empty(endpoint: CasfaEndpoint): VirtualFS {
    const root: DirEntry = {
      type: "dir",
      children: new Map(),
    };
    return new VirtualFS(endpoint, root);
  }

  // ============================================================================
  // Path Resolution
  // ============================================================================

  /**
   * Resolve a path to its entry, loading lazily as needed
   */
  private async resolvePath(path: string): Promise<VfsEntry | null> {
    const segments = getSegments(path);
    if (segments.length === 0) {
      return this.root;
    }

    let current = this.root;

    for (const segment of segments) {
      // Ensure current is a directory-like entry
      const children = await this.getChildren(current);
      if (!children) {
        return null;
      }

      const child = children.get(segment);
      if (!child) {
        return null;
      }

      current = child;
    }

    return current;
  }

  /**
   * Get children map for an entry, loading from CAS if needed
   */
  private async getChildren(entry: VfsEntry): Promise<Map<string, VfsEntry> | null> {
    if (entry.type === "pending") {
      // Pending files don't have children
      return null;
    }

    if (entry.type === "dir") {
      return entry.children;
    }

    // NodeEntry - might need to load children
    if (entry.children) {
      return entry.children;
    }

    // Load from CAS
    const node = await this.endpoint.getNode(entry.key);
    if (node.kind !== "dict") {
      return null;
    }

    // Build children map
    const children = new Map<string, VfsEntry>();
    if (node.children && node.childNames) {
      for (let i = 0; i < node.children.length; i++) {
        const name = node.childNames[i]!;
        const key = hashToKey(node.children[i]!);
        children.set(name, { type: "node", key });
      }
    }

    entry.children = children;
    return children;
  }

  /**
   * Ensure parent directories exist, creating them as needed
   */
  private async ensureParent(path: string): Promise<Map<string, VfsEntry>> {
    const segments = getSegments(path);
    if (segments.length === 0) {
      throw new Error("Cannot get parent of root");
    }

    // Pop the last segment (the target name)
    segments.pop();

    let current = this.root;

    for (const segment of segments) {
      const children = await this.getChildren(current);

      if (!children) {
        throw new Error(`Cannot create directory inside file: ${segment}`);
      }

      let child = children.get(segment);
      if (!child) {
        // Create intermediate directory
        child = { type: "dir", children: new Map() };
        children.set(segment, child);
        this.markModified();
      } else if (child.type === "pending") {
        throw new Error(`Cannot create directory inside file: ${segment}`);
      }

      current = child;
    }

    const children = await this.getChildren(current);
    if (!children) {
      throw new Error("Parent is not a directory");
    }

    return children;
  }

  /**
   * Mark as modified
   */
  private markModified(): void {
    this.modified = true;
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Check if a path exists
   */
  async exists(path: string): Promise<boolean> {
    const entry = await this.resolvePath(path);
    return entry !== null;
  }

  /**
   * Get file/directory info
   */
  async stat(path: string): Promise<FileInfo | null> {
    const entry = await this.resolvePath(path);
    if (!entry) {
      return null;
    }

    if (entry.type === "pending") {
      return {
        isFile: true,
        isDirectory: false,
        size: entry.data.length,
      };
    }

    if (entry.type === "dir") {
      return {
        isFile: false,
        isDirectory: true,
        size: 0,
      };
    }

    // NodeEntry - need to check if file or dict
    const node = await this.endpoint.getNode(entry.key);
    return {
      isFile: node.kind !== "dict",
      isDirectory: node.kind === "dict",
      size: node.size,
      key: entry.key,
    };
  }

  /**
   * List directory contents
   */
  async list(path: string): Promise<string[]> {
    const entry = await this.resolvePath(path);
    if (!entry) {
      throw new Error(`Path not found: ${path}`);
    }

    const children = await this.getChildren(entry);
    if (!children) {
      throw new Error(`Not a directory: ${path}`);
    }

    return Array.from(children.keys());
  }

  /**
   * Read file content
   */
  async readFile(path: string): Promise<Uint8Array> {
    const entry = await this.resolvePath(path);
    if (!entry) {
      throw new Error(`File not found: ${path}`);
    }

    if (entry.type === "pending") {
      return entry.data;
    }

    if (entry.type === "dir") {
      throw new Error(`Cannot read directory: ${path}`);
    }

    // NodeEntry - read from CAS
    return this.endpoint.readFile(entry.key);
  }

  /**
   * Write file content (creates parent directories as needed)
   */
  async writeFile(path: string, data: Uint8Array, options?: WriteFileOptions): Promise<void> {
    const { name } = splitPath(path);
    if (!name) {
      throw new Error("Cannot write to root");
    }

    const parentChildren = await this.ensureParent(path);

    parentChildren.set(name, {
      type: "pending",
      data,
      contentType: options?.contentType ?? "application/octet-stream",
    });

    this.markModified();
  }

  /**
   * Delete a file or directory (unlinks from parent)
   */
  async delete(path: string): Promise<void> {
    const { parent, name } = splitPath(path);
    if (!name) {
      throw new Error("Cannot delete root");
    }

    const parentEntry = await this.resolvePath(parent);
    if (!parentEntry) {
      throw new Error(`Parent not found: ${parent}`);
    }

    const children = await this.getChildren(parentEntry);
    if (!children) {
      throw new Error(`Parent is not a directory: ${parent}`);
    }

    if (!children.has(name)) {
      throw new Error(`Path not found: ${path}`);
    }

    children.delete(name);
    this.markModified();
  }

  /**
   * Move/rename a file or directory
   */
  async move(srcPath: string, dstPath: string): Promise<void> {
    const srcEntry = await this.resolvePath(srcPath);
    if (!srcEntry) {
      throw new Error(`Source not found: ${srcPath}`);
    }

    const { parent: srcParent, name: srcName } = splitPath(srcPath);
    const { name: dstName } = splitPath(dstPath);

    if (!srcName || !dstName) {
      throw new Error("Cannot move root");
    }

    // Get source parent children
    const srcParentEntry = await this.resolvePath(srcParent);
    if (!srcParentEntry) {
      throw new Error(`Source parent not found: ${srcParent}`);
    }
    const srcChildren = await this.getChildren(srcParentEntry);
    if (!srcChildren) {
      throw new Error(`Source parent is not a directory: ${srcParent}`);
    }

    // Get/create destination parent
    const dstChildren = await this.ensureParent(dstPath);

    // Move the entry (override if exists)
    dstChildren.set(dstName, srcEntry);
    srcChildren.delete(srcName);

    this.markModified();
  }

  /**
   * Mount an existing CAS node at a path
   */
  async mount(path: string, key: string): Promise<void> {
    const { name } = splitPath(path);
    if (!name) {
      throw new Error("Cannot mount at root");
    }

    // Verify the key exists
    const exists = await this.endpoint.has(key);
    if (!exists) {
      throw new Error(`Node not found: ${key}`);
    }

    const parentChildren = await this.ensureParent(path);
    parentChildren.set(name, { type: "node", key });

    this.markModified();
  }

  /**
   * Create a directory
   */
  async mkdir(path: string): Promise<void> {
    const { name } = splitPath(path);
    if (!name) {
      throw new Error("Root already exists");
    }

    const parentChildren = await this.ensureParent(path);

    if (parentChildren.has(name)) {
      // Already exists, check if it's a directory
      const existing = parentChildren.get(name)!;
      if (existing.type === "pending") {
        throw new Error(`File exists at path: ${path}`);
      }
      // It's a directory, OK
      return;
    }

    parentChildren.set(name, { type: "dir", children: new Map() });
    this.markModified();
  }

  // ============================================================================
  // Build
  // ============================================================================

  /**
   * Build the final dict, uploading all pending files
   * Returns the new root key
   */
  async build(): Promise<string> {
    return this.buildEntry(this.root);
  }

  /**
   * Recursively build an entry, returning its key
   */
  private async buildEntry(entry: VfsEntry): Promise<string> {
    if (entry.type === "pending") {
      // Upload the file
      const result = await this.endpoint.putFile(entry.data, entry.contentType);
      return result.key;
    }

    if (entry.type === "node" && !entry.children) {
      // Unmodified node, return as-is
      return entry.key;
    }

    // Directory or modified node - need to rebuild
    const children = entry.type === "dir" ? entry.children : entry.children!;

    // Build all children first
    const entries: Array<{ name: string; key: string }> = [];

    for (const [name, child] of children) {
      const key = await this.buildEntry(child);
      entries.push({ name, key });
    }

    // Sort entries by name for consistency
    entries.sort((a, b) => a.name.localeCompare(b.name));

    // Create the dict
    return this.endpoint.makeDict(entries);
  }

  /**
   * Check if there are any modifications
   */
  hasModifications(): boolean {
    return this.modified;
  }
}
