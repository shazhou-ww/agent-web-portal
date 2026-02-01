/**
 * CasController tests
 */
import { describe, expect, it, beforeEach } from "bun:test";
import { CasController } from "../src/controller.ts";
import { MemoryStorageProvider, WebCryptoHashProvider } from "../src/providers.ts";
import { DEFAULT_NODE_LIMIT } from "../src/constants.ts";
import { computeUsableSpace } from "../src/topology.ts";

describe("CasController", () => {
  let storage: MemoryStorageProvider;
  let controller: CasController;

  beforeEach(() => {
    storage = new MemoryStorageProvider();
    controller = new CasController({
      storage,
      hash: new WebCryptoHashProvider(),
    });
  });

  describe("writeFile - small files", () => {
    it("should write a small file as single node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await controller.writeFile(data, "application/octet-stream");

      expect(result.key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(result.size).toBe(5);
      expect(result.nodeCount).toBe(1);
      expect(storage.size()).toBe(1);
    });

    it("should write empty file", async () => {
      const data = new Uint8Array([]);
      const result = await controller.writeFile(data, "text/plain");

      expect(result.size).toBe(0);
      expect(result.nodeCount).toBe(1);
    });

    it("should produce consistent hashes for same content", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const result1 = await controller.writeFile(data, "application/octet-stream");
      const result2 = await controller.writeFile(data, "application/octet-stream");

      expect(result1.key).toBe(result2.key);
    });
  });

  describe("writeFile - large files with B-Tree", () => {
    it("should split file larger than node limit", async () => {
      // Use smaller node limit for testing
      const smallController = new CasController({
        storage,
        hash: new WebCryptoHashProvider(),
        nodeLimit: 1024, // 1KB limit
      });

      // Create 2KB data
      const data = new Uint8Array(2048);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const result = await smallController.writeFile(data, "application/octet-stream");

      expect(result.size).toBe(2048);
      expect(result.nodeCount).toBeGreaterThan(1);
      expect(storage.size()).toBeGreaterThan(1);
    });

    it("should create multi-level tree for very large files", async () => {
      // Use very small node limit to force multi-level tree
      const tinyController = new CasController({
        storage,
        hash: new WebCryptoHashProvider(),
        nodeLimit: 128, // Very small limit
      });

      // Create data that requires depth > 2
      const L = computeUsableSpace(128);
      const dataSize = L * 3; // Should require 2-level tree
      const data = new Uint8Array(dataSize);
      for (let i = 0; i < data.length; i++) {
        data[i] = i % 256;
      }

      const result = await tinyController.writeFile(data, "application/octet-stream");

      expect(result.size).toBe(dataSize);
      expect(result.nodeCount).toBeGreaterThan(2);
    });
  });

  describe("readFile", () => {
    it("should read back small file correctly", async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await controller.writeFile(original, "application/octet-stream");

      const retrieved = await controller.readFile(result.key);
      expect(retrieved).toEqual(original);
    });

    it("should read back large file correctly", async () => {
      const smallController = new CasController({
        storage,
        hash: new WebCryptoHashProvider(),
        nodeLimit: 256,
      });

      // Create data larger than node limit
      const original = new Uint8Array(1000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }

      const result = await smallController.writeFile(original, "application/octet-stream");
      const retrieved = await smallController.readFile(result.key);

      expect(retrieved).toEqual(original);
    });

    it("should return null for non-existent key", async () => {
      const result = await controller.readFile("sha256:" + "a".repeat(64));
      expect(result).toBeNull();
    });
  });

  describe("makeCollection", () => {
    it("should make a collection with entries", async () => {
      // First write some files
      const file1 = await controller.writeFile(new Uint8Array([1, 2, 3]), "text/plain");
      const file2 = await controller.writeFile(new Uint8Array([4, 5, 6]), "text/plain");

      const collectionKey = await controller.makeCollection([
        { name: "file1.txt", key: file1.key },
        { name: "file2.txt", key: file2.key },
      ]);

      expect(collectionKey).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(storage.size()).toBe(3); // 2 files + 1 collection
    });

    it("should make empty collection", async () => {
      const key = await controller.makeCollection([]);
      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should compute size as sum of children logical sizes", async () => {
      // Create files with known sizes
      const file1 = await controller.writeFile(new Uint8Array(100), "text/plain"); // 100 bytes
      const file2 = await controller.writeFile(new Uint8Array(200), "text/plain"); // 200 bytes

      const collectionKey = await controller.makeCollection([
        { name: "a.txt", key: file1.key },
        { name: "b.txt", key: file2.key },
      ]);

      const node = await controller.getNode(collectionKey);
      expect(node).not.toBeNull();
      expect(node!.size).toBe(300); // 100 + 200
    });

    it("should compute nested collection size correctly", async () => {
      // Create files
      const file1 = await controller.writeFile(new Uint8Array(50), "text/plain");
      const file2 = await controller.writeFile(new Uint8Array(150), "text/plain");

      // Create inner collection with file1
      const innerCollection = await controller.makeCollection([
        { name: "inner.txt", key: file1.key },
      ]);

      // Create outer collection with inner collection and file2
      const outerCollection = await controller.makeCollection([
        { name: "subdir", key: innerCollection },
        { name: "outer.txt", key: file2.key },
      ]);

      const node = await controller.getNode(outerCollection);
      expect(node).not.toBeNull();
      // Outer size = inner collection size (50) + file2 size (150) = 200
      expect(node!.size).toBe(200);
    });
  });

  describe("getTree", () => {
    it("should return tree structure for single file", async () => {
      const result = await controller.writeFile(new Uint8Array([1, 2, 3]), "image/png");
      const tree = await controller.getTree(result.key);

      expect(Object.keys(tree.nodes)).toHaveLength(1);
      const node = tree.nodes[result.key];
      expect(node).toBeDefined();
      expect(node!.kind).toBe("chunk");
      expect(node!.size).toBe(3);
      expect(node!.contentType).toBe("image/png");
    });

    it("should return tree structure for collection", async () => {
      const file1 = await controller.writeFile(new Uint8Array([1, 2, 3]), "text/plain");
      const file2 = await controller.writeFile(new Uint8Array([4, 5, 6]), "text/plain");
      const collectionKey = await controller.makeCollection([
        { name: "a.txt", key: file1.key },
        { name: "b.txt", key: file2.key },
      ]);

      const tree = await controller.getTree(collectionKey);

      expect(Object.keys(tree.nodes)).toHaveLength(3);
      const collectionNode = tree.nodes[collectionKey];
      expect(collectionNode!.kind).toBe("collection");
      expect(collectionNode!.childNames).toEqual(["a.txt", "b.txt"]);
      // Collection size should be sum of children's logical sizes (3 + 3 = 6)
      expect(collectionNode!.size).toBe(6);
    });

    it("should respect limit parameter", async () => {
      // Create nested structure
      const files = await Promise.all(
        [1, 2, 3, 4, 5].map((i) =>
          controller.writeFile(new Uint8Array([i]), "text/plain")
        )
      );

      const collectionKey = await controller.makeCollection(
        files.map((f, i) => ({ name: `file${i}.txt`, key: f.key }))
      );

      // Request only 2 nodes
      const tree = await controller.getTree(collectionKey, 2);
      expect(Object.keys(tree.nodes).length).toBeLessThanOrEqual(2);
    });
  });

  describe("getNode", () => {
    it("should return decoded node", async () => {
      const result = await controller.writeFile(new Uint8Array([1, 2, 3]), "image/png");
      const node = await controller.getNode(result.key);

      expect(node).not.toBeNull();
      expect(node!.kind).toBe("chunk");
      expect(node!.data).toEqual(new Uint8Array([1, 2, 3]));
      expect(node!.contentType).toBe("image/png");
    });

    it("should return null for missing node", async () => {
      const node = await controller.getNode("sha256:" + "0".repeat(64));
      expect(node).toBeNull();
    });
  });

  describe("openFileStream", () => {
    it("should stream file content", async () => {
      const original = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const result = await controller.writeFile(original, "application/octet-stream");

      const stream = controller.openFileStream(result.key);
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
      const smallController = new CasController({
        storage,
        hash: new WebCryptoHashProvider(),
        nodeLimit: 256,
      });

      const original = new Uint8Array(1000);
      for (let i = 0; i < original.length; i++) {
        original[i] = i % 256;
      }

      const result = await smallController.writeFile(original, "application/octet-stream");
      const stream = smallController.openFileStream(result.key);
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

  describe("putChunk", () => {
    it("should put raw chunk", async () => {
      const data = new Uint8Array([100, 200, 255]);
      const key = await controller.putChunk(data, "application/octet-stream");

      expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
      expect(await controller.has(key)).toBe(true);
    });
  });

  describe("has", () => {
    it("should return true for existing key", async () => {
      const result = await controller.writeFile(new Uint8Array([1]), "text/plain");
      expect(await controller.has(result.key)).toBe(true);
    });

    it("should return false for non-existing key", async () => {
      expect(await controller.has("sha256:" + "f".repeat(64))).toBe(false);
    });
  });
});
