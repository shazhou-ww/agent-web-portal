/**
 * Validation tests
 */

import { describe, expect, it } from "bun:test";
import { MAGIC } from "../src/constants.ts";
import { encodeDictNode, encodeFileNode } from "../src/node.ts";
import { MemoryStorageProvider, WebCryptoHashProvider } from "../src/providers.ts";
import { validateNode, validateNodeStructure } from "../src/validation.ts";
import { hashToKey } from "../src/utils.ts";

const hashProvider = new WebCryptoHashProvider();

describe("Validation", () => {
  describe("validateNodeStructure", () => {
    it("should validate correct file node", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain" },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("file");
      expect(result.size).toBe(3);
      expect(result.childKeys).toEqual([]);
    });

    it("should validate correct dict node", async () => {
      // First create some children
      const child1 = await encodeFileNode({ data: new Uint8Array([1]) }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array([2]) }, hashProvider);

      const encoded = await encodeDictNode(
        {
          size: 2,
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("dict");
      expect(result.size).toBe(2);
      expect(result.childKeys).toHaveLength(2);
    });

    it("should reject buffer too small", () => {
      const result = validateNodeStructure(new Uint8Array(10));
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too small");
    });

    it("should reject invalid magic", () => {
      const bytes = new Uint8Array(32);
      bytes[0] = 0xff;
      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("magic");
    });

    it("should reject truncated children section", async () => {
      const encoded = await encodeFileNode(
        {
          data: new Uint8Array([1, 2, 3]),
          children: [new Uint8Array(32)], // Add a child
        },
        hashProvider
      );

      // Truncate to remove child hash
      const truncated = encoded.bytes.slice(0, 40);
      const result = validateNodeStructure(truncated);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("exceeds buffer");
    });

    it("should validate unicode names in dict node", async () => {
      const child = await encodeFileNode({ data: new Uint8Array([1]) }, hashProvider);

      const encoded = await encodeDictNode(
        {
          size: 1,
          children: [child.hash],
          childNames: ["文件.txt"],
        },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
    });
  });

  describe("validateNode", () => {
    it("should validate hash matches", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain" },
        hashProvider
      );
      const key = hashToKey(encoded.hash);

      const result = await validateNode(encoded.bytes, key, hashProvider);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("file");
    });

    it("should reject hash mismatch", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]) },
        hashProvider
      );

      // Use wrong key
      const wrongKey = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
      const result = await validateNode(encoded.bytes, wrongKey, hashProvider);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Hash mismatch");
    });

    it("should check children existence", async () => {
      const child = await encodeFileNode({ data: new Uint8Array([1]) }, hashProvider);
      const childKey = hashToKey(child.hash);

      const storage = new MemoryStorageProvider();
      await storage.put(childKey, child.bytes);

      const dict = await encodeDictNode(
        {
          size: 1,
          children: [child.hash],
          childNames: ["a.txt"],
        },
        hashProvider
      );
      const dictKey = hashToKey(dict.hash);

      // With child existing
      const result1 = await validateNode(
        dict.bytes,
        dictKey,
        hashProvider,
        (key) => storage.has(key)
      );
      expect(result1.valid).toBe(true);

      // With child missing
      const result2 = await validateNode(
        dict.bytes,
        dictKey,
        hashProvider,
        () => Promise.resolve(false)
      );
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain("Missing children");
    });

    it("should validate dict node size", async () => {
      const child1 = await encodeFileNode({ data: new Uint8Array(100) }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array(200) }, hashProvider);
      const child1Key = hashToKey(child1.hash);
      const child2Key = hashToKey(child2.hash);

      const storage = new MemoryStorageProvider();
      await storage.put(child1Key, child1.bytes);
      await storage.put(child2Key, child2.bytes);

      // Correct size (100 + 200 = 300)
      const correctDict = await encodeDictNode(
        {
          size: 300,
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      const result1 = await validateNode(
        correctDict.bytes,
        hashToKey(correctDict.hash),
        hashProvider,
        (key) => storage.has(key),
        async (key) => {
          if (key === child1Key) return 100;
          if (key === child2Key) return 200;
          return null;
        }
      );
      expect(result1.valid).toBe(true);

      // Wrong size
      const wrongDict = await encodeDictNode(
        {
          size: 999, // Wrong!
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      const result2 = await validateNode(
        wrongDict.bytes,
        hashToKey(wrongDict.hash),
        hashProvider,
        (key) => storage.has(key),
        async (key) => {
          if (key === child1Key) return 100;
          if (key === child2Key) return 200;
          return null;
        }
      );
      expect(result2.valid).toBe(false);
      expect(result2.error).toContain("size mismatch");
    });
  });
});
