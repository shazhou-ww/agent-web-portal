/**
 * Memory DAG Storage
 *
 * In-memory implementation of DagDb for local development.
 */

import type { CasDagNode, IDagDb } from "./types.ts";

export class MemoryDagDb implements IDagDb {
  private nodes = new Map<string, CasDagNode>();

  async getNode(key: string): Promise<CasDagNode | null> {
    return this.nodes.get(key) ?? null;
  }

  async putNode(
    key: string,
    children: string[],
    contentType: string,
    size: number
  ): Promise<CasDagNode> {
    const node: CasDagNode = {
      key,
      children,
      contentType,
      size,
      createdAt: Date.now(),
    };
    this.nodes.set(key, node);
    return node;
  }

  async collectDagKeys(rootKey: string): Promise<string[]> {
    const visited = new Set<string>();
    const queue = [rootKey];
    while (queue.length > 0) {
      const key = queue.shift()!;
      if (visited.has(key)) continue;
      visited.add(key);
      const node = this.nodes.get(key);
      if (node?.children) {
        for (const child of node.children) {
          if (!visited.has(child)) queue.push(child);
        }
      }
    }
    return Array.from(visited);
  }
}
