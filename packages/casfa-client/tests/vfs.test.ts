/**
 * Tests for VirtualFS
 */

import { describe, expect, it, beforeEach, mock } from "bun:test";
import { VirtualFS } from "../src/vfs.ts";
import type { CasfaEndpoint } from "../src/endpoint.ts";
import type { CasNode } from "@agent-web-portal/cas-core";
import { hashToKey } from "@agent-web-portal/cas-core";

// ============================================================================
// Mock Helpers
// ============================================================================

function createMockEndpoint(nodes: Map<string, CasNode>): CasfaEndpoint {
  return {
    getNode: async (key: string): Promise<CasNode> => {
      const node = nodes.get(key);
      if (!node) {
        throw new Error(`Node not found: ${key}`);
      }
      return node;
    },
    readFile: async (key: string): Promise<Uint8Array> => {
      const node = nodes.get(key);
      if (!node || node.kind === "collection") {
        throw new Error(`Cannot read: ${key}`);
      }
      return node.data ?? new Uint8Array();
    },
    has: async (key: string): Promise<boolean> => {
      return nodes.has(key);
    },
    putFile: async (data: Uint8Array, contentType: string) => {
      const key = `sha256:${Date.now()}_${Math.random()}`;
      nodes.set(key, { kind: "chunk", size: data.length, data, contentType });
      return { key, size: data.length, nodeCount: 1 };
    },
    makeCollection: async (entries: Array<{ name: string; key: string }>) => {
      const key = `sha256:col_${Date.now()}_${Math.random()}`;
      const children: Uint8Array[] = [];
      const childNames: string[] = [];
      let totalSize = 0;

      for (const entry of entries) {
        // Convert key to fake hash (32 bytes)
        const hash = new Uint8Array(32);
        const keyBytes = new TextEncoder().encode(entry.key);
        hash.set(keyBytes.slice(0, 32));
        children.push(hash);
        childNames.push(entry.name);

        const childNode = nodes.get(entry.key);
        if (childNode) {
          totalSize += childNode.size;
        }
      }

      nodes.set(key, {
        kind: "collection",
        size: totalSize,
        children,
        childNames,
      });
      return key;
    },
  } as unknown as CasfaEndpoint;
}

function createHash(keyStr: string): Uint8Array {
  const hash = new Uint8Array(32);
  const bytes = new TextEncoder().encode(keyStr);
  hash.set(bytes.slice(0, 32));
  return hash;
}

// ============================================================================
// Tests
// ============================================================================

describe("VirtualFS", () => {
  describe("empty VFS", () => {
    it("should create empty VFS", () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      expect(vfs).toBeDefined();
      expect(vfs.hasModifications()).toBe(false);
    });

    it("should list empty root", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const items = await vfs.list("");
      expect(items).toEqual([]);
    });

    it("should write file to empty VFS", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("Hello, World!");
      await vfs.writeFile("hello.txt", content);

      expect(vfs.hasModifications()).toBe(true);
      expect(await vfs.exists("hello.txt")).toBe(true);
    });
  });

  describe("path operations", () => {
    it("should create nested directories automatically", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("nested file");
      await vfs.writeFile("a/b/c/file.txt", content);

      expect(await vfs.exists("a")).toBe(true);
      expect(await vfs.exists("a/b")).toBe(true);
      expect(await vfs.exists("a/b/c")).toBe(true);
      expect(await vfs.exists("a/b/c/file.txt")).toBe(true);
    });

    it("should delete file", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("to delete");
      await vfs.writeFile("file.txt", content);
      expect(await vfs.exists("file.txt")).toBe(true);

      await vfs.delete("file.txt");
      expect(await vfs.exists("file.txt")).toBe(false);
    });

    it("should move file", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("movable");
      await vfs.writeFile("old/file.txt", content);

      await vfs.move("old/file.txt", "new/file.txt");

      expect(await vfs.exists("old/file.txt")).toBe(false);
      expect(await vfs.exists("new/file.txt")).toBe(true);
    });

    it("should read written file", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("readable content");
      await vfs.writeFile("test.txt", content);

      const read = await vfs.readFile("test.txt");
      expect(new TextDecoder().decode(read)).toBe("readable content");
    });

    it("should mkdir", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.mkdir("mydir");
      expect(await vfs.exists("mydir")).toBe(true);

      const stat = await vfs.stat("mydir");
      expect(stat?.isDirectory).toBe(true);
    });

    it("should list directory contents", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.writeFile("dir/a.txt", new Uint8Array([1]));
      await vfs.writeFile("dir/b.txt", new Uint8Array([2]));
      await vfs.writeFile("dir/c.txt", new Uint8Array([3]));

      const items = await vfs.list("dir");
      expect(items.sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
    });
  });

  describe("fromCollection", () => {
    it("should load existing collection", async () => {
      const nodes = new Map<string, CasNode>();

      // Create a file node
      const fileKey = "sha256:file123";
      nodes.set(fileKey, {
        kind: "chunk",
        size: 5,
        data: new TextEncoder().encode("hello"),
        contentType: "text/plain",
      });

      // Create a collection with the file
      const rootKey = "sha256:root123";
      nodes.set(rootKey, {
        kind: "collection",
        size: 5,
        children: [createHash(fileKey)],
        childNames: ["hello.txt"],
      });

      const endpoint = createMockEndpoint(nodes);
      const vfs = await VirtualFS.fromCollection(endpoint, rootKey);

      expect(await vfs.exists("hello.txt")).toBe(true);
      expect(await vfs.list("")).toEqual(["hello.txt"]);
    });

    it("should reject non-collection root", async () => {
      const nodes = new Map<string, CasNode>();

      const fileKey = "sha256:file123";
      nodes.set(fileKey, {
        kind: "chunk",
        size: 5,
        data: new TextEncoder().encode("hello"),
      });

      const endpoint = createMockEndpoint(nodes);

      await expect(VirtualFS.fromCollection(endpoint, fileKey)).rejects.toThrow(
        "Root must be a collection node"
      );
    });
  });

  describe("mount", () => {
    it("should mount existing node", async () => {
      const nodes = new Map<string, CasNode>();

      // Create a node to mount
      const mountKey = "sha256:mountable";
      nodes.set(mountKey, {
        kind: "chunk",
        size: 10,
        data: new TextEncoder().encode("mount data"),
      });

      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.mount("mounted/file.txt", mountKey);

      expect(await vfs.exists("mounted/file.txt")).toBe(true);
      const stat = await vfs.stat("mounted/file.txt");
      expect(stat?.key).toBe(mountKey);
    });

    it("should reject mounting non-existent node", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await expect(vfs.mount("path", "sha256:nonexistent")).rejects.toThrow(
        "Node not found"
      );
    });
  });

  describe("build", () => {
    it("should build empty collection", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const key = await vfs.build();
      expect(key).toBeDefined();
      expect(key.startsWith("sha256:")).toBe(true);
    });

    it("should build collection with files", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.writeFile("a.txt", new TextEncoder().encode("a"));
      await vfs.writeFile("b.txt", new TextEncoder().encode("b"));

      const key = await vfs.build();
      expect(key).toBeDefined();

      // Verify the collection was created
      const node = nodes.get(key);
      expect(node).toBeDefined();
      expect(node?.kind).toBe("collection");
      expect(node?.childNames?.sort()).toEqual(["a.txt", "b.txt"]);
    });

    it("should build nested structure", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.writeFile("root.txt", new TextEncoder().encode("root"));
      await vfs.writeFile("sub/file.txt", new TextEncoder().encode("sub"));

      const key = await vfs.build();
      expect(key).toBeDefined();

      // Root collection should have 2 children: root.txt and sub
      const node = nodes.get(key);
      expect(node?.childNames?.sort()).toEqual(["root.txt", "sub"]);
    });
  });

  describe("stat", () => {
    it("should stat file", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const content = new TextEncoder().encode("test content");
      await vfs.writeFile("file.txt", content);

      const stat = await vfs.stat("file.txt");
      expect(stat).not.toBeNull();
      expect(stat?.isFile).toBe(true);
      expect(stat?.isDirectory).toBe(false);
      expect(stat?.size).toBe(content.length);
    });

    it("should stat directory", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      await vfs.mkdir("mydir");

      const stat = await vfs.stat("mydir");
      expect(stat).not.toBeNull();
      expect(stat?.isFile).toBe(false);
      expect(stat?.isDirectory).toBe(true);
    });

    it("should return null for non-existent path", async () => {
      const nodes = new Map<string, CasNode>();
      const endpoint = createMockEndpoint(nodes);
      const vfs = VirtualFS.empty(endpoint);

      const stat = await vfs.stat("nonexistent");
      expect(stat).toBeNull();
    });
  });
});
