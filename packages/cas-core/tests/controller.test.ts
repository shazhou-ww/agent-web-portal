/**
 * Controller tests (functional API)
 */
import { describe, expect, it, beforeEach } from "bun:test";
import {
  writeFile,
  readFile,
  makeDict,
  getTree,
  getNode,
  openFileStream,
  putFileNode,
  has,
  type CasContext,
} from "../src/controller.ts";
import { createMemoryStorage, createWebCryptoHash, type MemoryStorage } from "../src/providers.ts";
import { computeUsableSpace } from "../src/topology.ts";

describe("Controller", () => {
  let storage: MemoryStorage;
  let ctx: CasContext;

  beforeEach(() => {
    storage = createMemoryStorage();
    ctx = {
      storage,
      hash: createWebCryptoHash(),
    };
  });

  describe("writeFile - small files", () => {
    it("should write a small file as single node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await writeFile(ctx, data, "application/octet-stream");

      expect(result.key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.size).toBe(5);
      expect(result.nodeCount).toBe(1);
      expect(storage.size()).toBe(1);
    });

    it("should write empty file", async () => {
      const data = new Uint8Array([]);
      const result = await writeFile(ctx, data, "text/plain");

      expect(result.size).toBe(0);
      expect(result.nodeCount).toBe(1);
    });

    it("should produce consistent hashes for same content", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const result1 = await writeFile(ctx, data, "application/octet-stream");
      const result2 = await writeFile(ctx, data, "application/octet-stream");

      expect(result1.key).toBe(result2.key);
    });
  });

  describe("writeFile - large files with B-Tree", () => {
    it("should split file larger than node limit", async () => {
      const smallCtx: CasContext = {
        storage,
        hash: createWebCryptoHash(),
        nodeLimit: 1024, // 1KB limit
      };

      // Create 2KB data
      const data = new Uint8Array(2048);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const result = await writeFile(smallCtx, data, "application/octet-stream");

      expect(result.size).toBe(2048);
      expect(result.nodeCount).toBeGreaterThan(1);
      expect(storage.size()).toBeGreaterThan(1);
    });

    it("should create multi-level tree for very large files", async () => {
      const tinyCtx: CasContext = {
        storage,
        hash: createWebCryptoHash(),
        nodeLimit: 128, // Very small limit
      };

      // Create data that requires depth > 2
      const L = computeUsableSpace(128);
      const dataSize = L * 3; // Should require 2-level tree
      const data = new Uint8Array(dataSize);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const result = await writeFile(tinyCtx, data, "application/octet-stream");

      expect(result.size).toBe(dataSize);
      expect(result.nodeCount).toBeGreaterThan(2);
    });
  });

  describe("readFile", () => {
    it("should read back small file correctly", async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await writeFile(ctx, original, "application/octet-stream");

      const retrieved = await readFile(ctx, result.key);
      expect(retrieved).toEqual(original);
    });

    it("should read back large file correctly", async () => {
      const smallCtx: CasContext = {
        storage,
        hash: createWebCryptoHash(),
        nodeLimit: 256,
      };

      // Create data larger than node limit
      const original = new Uint8Array(1000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }

      const result = await writeFile(smallCtx, original, "application/octet-stream");
      const retrieved = await readFile(smallCtx, result.key);

      expect(retrieved).toEqual(original);
    });

    it("should return null for non-existent key", async () => {
      const result = await readFile(ctx, "sha256:" + "a".repeat(64));
      expect(result).toBeNull();
    });
  });

  describe("makeDict", () => {
    it("should make a dict with entries", async () => {
      // First write some files
      const file1 = await writeFile(ctx, new Uint8Array([1, 2, 3]), "text/plain");
      const file2 = await writeFile(ctx, new Uint8Array([4, 5, 6]), "text/plain");

      const dictKey = await makeDict(ctx, [
        { name: "file1.txt", key: file1.key },
        { name: "file2.txt", key: file2.key },
      ]);

      expect(dictKey).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(storage.size()).toBe(3); // 2 files + 1 dict
    });

    it("should make empty dict", async () => {
      const key = await makeDict(ctx, []);
      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should compute size as sum of children logical sizes", async () => {
      // Create files with known sizes
      const file1 = await writeFile(ctx, new Uint8Array(100), "text/plain"); // 100 bytes
      const file2 = await writeFile(ctx, new Uint8Array(200), "text/plain"); // 200 bytes

      const dictKey = await makeDict(ctx, [
        { name: "a.txt", key: file1.key },
        { name: "b.txt", key: file2.key },
      ]);

      const node = await getNode(ctx, dictKey);
      expect(node).not.toBeNull();
      expect(node!.size).toBe(300); // 100 + 200
    });

    it("should compute nested dict size correctly", async () => {
      // Create files
      const file1 = await writeFile(ctx, new Uint8Array(50), "text/plain");
      const file2 = await writeFile(ctx, new Uint8Array(150), "text/plain");

      // Create inner dict with file1
      const innerDict = await makeDict(ctx, [
        { name: "inner.txt", key: file1.key },
      ]);

      // Create outer dict with inner dict and file2
      const outerDict = await makeDict(ctx, [
        { name: "subdir", key: innerDict },
        { name: "outer.txt", key: file2.key },
      ]);

      const node = await getNode(ctx, outerDict);
      expect(node).not.toBeNull();
      // Outer size = inner dict size (50) + file2 size (150) = 200
      expect(node!.size).toBe(200);
    });
  });

  describe("getTree", () => {
    it("should return tree structure for single file", async () => {
      const result = await writeFile(ctx, new Uint8Array([1, 2, 3]), "image/png");
      const tree = await getTree(ctx, result.key);

      expect(Object.keys(tree.nodes)).toHaveLength(1);
      const node = tree.nodes[result.key];
      expect(node).toBeDefined();
      expect(node!.kind).toBe("file");
      expect(node!.size).toBe(3);
      expect(node!.contentType).toBe("image/png");
    });

    it("should return tree structure for dict", async () => {
      const file1 = await writeFile(ctx, new Uint8Array([1, 2, 3]), "text/plain");
      const file2 = await writeFile(ctx, new Uint8Array([4, 5, 6]), "text/plain");
      const dictKey = await makeDict(ctx, [
        { name: "a.txt", key: file1.key },
        { name: "b.txt", key: file2.key },
      ]);

      const tree = await getTree(ctx, dictKey);

      expect(Object.keys(tree.nodes)).toHaveLength(3);
      const dictNode = tree.nodes[dictKey];
      expect(dictNode!.kind).toBe("dict");
      expect(dictNode!.childNames).toEqual(["a.txt", "b.txt"]);
      // Dict size should be sum of children's logical sizes (3 + 3 = 6)
      expect(dictNode!.size).toBe(6);
    });

    it("should respect limit parameter", async () => {
      // Create nested structure
      const files = await Promise.all(
        [1, 2, 3, 4, 5].map((i) =>
          writeFile(ctx, new Uint8Array([i]), "text/plain")
        )
      );

      const dictKey = await makeDict(
        ctx,
        files.map((f, i) => ({ name: `file${i}.txt`, key: f.key }))
      );

      // Request only 2 nodes
      const tree = await getTree(ctx, dictKey, 2);
      expect(Object.keys(tree.nodes).length).toBeLessThanOrEqual(2);
    });
  });

  describe("getNode", () => {
    it("should return decoded node", async () => {
      const result = await writeFile(ctx, new Uint8Array([1, 2, 3]), "image/png");
      const node = await getNode(ctx, result.key);

      expect(node).not.toBeNull();
      expect(node!.kind).toBe("file");
      expect(node!.data).toEqual(new Uint8Array([1, 2, 3]));
      expect(node!.contentType).toBe("image/png");
    });

    it("should return null for missing node", async () => {
      const node = await getNode(ctx, "sha256:" + "0".repeat(64));
      expect(node).toBeNull();
    });
  });

  describe("openFileStream", () => {
    it("should stream file content", async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await writeFile(ctx, original, "application/octet-stream");

      const stream = openFileStream(ctx, result.key);
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      // Combine chunks
      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      expect(combined).toEqual(original);
    });

    it("should stream large multi-node file", async () => {
      const smallCtx: CasContext = {
        storage,
        hash: createWebCryptoHash(),
        nodeLimit: 256,
      };

      const original = new Uint8Array(1000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }

      const result = await writeFile(smallCtx, original, "application/octet-stream");
      const stream = openFileStream(smallCtx, result.key);
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }

      const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }

      expect(combined).toEqual(original);
    });
  });

  describe("putFileNode", () => {
    it("should put raw file node", async () => {
      const data = new Uint8Array([100, 200, 255]);
      const key = await putFileNode(ctx, data, "application/octet-stream");

      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(await has(ctx, key)).toBe(true);
    });
  });

  describe("has", () => {
    it("should return true for existing key", async () => {
      const result = await writeFile(ctx, new Uint8Array([1]), "text/plain");
      expect(await has(ctx, result.key)).toBe(true);
    });

    it("should return false for non-existing key", async () => {
      expect(await has(ctx, "sha256:" + "f".repeat(64))).toBe(false);
    });
  });
});
