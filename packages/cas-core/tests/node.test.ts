/**
 * Node encoding/decoding roundtrip tests
 */
import { describe, expect, it } from "bun:test";
import { FLAGS, HASH_SIZE, HEADER_SIZE } from "../src/constants.ts";
import { decodeNode, encodeChunk, encodeChunkWithSize, encodeCollection, getNodeKind, isValidNode } from "../src/node.ts";
import type { HashProvider } from "../src/types.ts";

// Mock hash provider for testing
const mockHashProvider: HashProvider = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    // Simple mock: just return first 32 bytes or pad with zeros
    const hash = new Uint8Array(HASH_SIZE);
    hash.set(data.slice(0, Math.min(data.length, HASH_SIZE)));
    return hash;
  },
};

// Real hash provider using Web Crypto
const realHashProvider: HashProvider = {
  async sha256(data: Uint8Array): Promise<Uint8Array> {
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return new Uint8Array(hashBuffer);
  },
};

describe("Node", () => {
  describe("encodeChunk", () => {
    it("should encode simple chunk", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeChunk({ data }, mockHashProvider);

      expect(result.bytes.length).toBeGreaterThanOrEqual(HEADER_SIZE + 5);
      expect(result.hash.length).toBe(HASH_SIZE);
    });

    it("should encode chunk with content type", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeChunk(
        { data, contentType: "image/png" },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("chunk");
      expect(decoded.contentType).toBe("image/png");
      expect(decoded.data).toEqual(data);
    });

    it("should encode chunk with children", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const child1 = new Uint8Array(HASH_SIZE).fill(0xaa);
      const child2 = new Uint8Array(HASH_SIZE).fill(0xbb);

      const result = await encodeChunk(
        { data, children: [child1, child2] },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("chunk");
      expect(decoded.children).toHaveLength(2);
      expect(decoded.children![0]).toEqual(child1);
      expect(decoded.children![1]).toEqual(child2);
    });
  });

  describe("encodeChunkWithSize", () => {
    it("should set explicit size", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeChunkWithSize(
        { data },
        1000000, // logical size
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.size).toBe(1000000);
    });
  });

  describe("encodeCollection", () => {
    it("should encode collection with children and names", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);
      const child2 = new Uint8Array(HASH_SIZE).fill(0x22);

      const result = await encodeCollection(
        {
          size: 5000,
          children: [child1, child2],
          childNames: ["file1.txt", "folder2"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("collection");
      expect(decoded.size).toBe(5000);
      expect(decoded.children).toHaveLength(2);
      expect(decoded.childNames).toEqual(["file1.txt", "folder2"]);
    });

    it("should encode collection with content type", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      const result = await encodeCollection(
        {
          size: 100,
          children: [child1],
          childNames: ["item"],
          contentType: "inode/directory",
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.contentType).toBe("inode/directory");
    });

    it("should throw on children/names count mismatch", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      await expect(
        encodeCollection(
          {
            size: 100,
            children: [child1],
            childNames: ["a", "b"],
          },
          mockHashProvider
        )
      ).rejects.toThrow(/mismatch/);
    });

    it("should handle unicode names", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      const result = await encodeCollection(
        {
          size: 100,
          children: [child1],
          childNames: ["文件夹 📁"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.childNames).toEqual(["文件夹 📁"]);
    });

    it("should handle empty collection", async () => {
      const result = await encodeCollection(
        {
          size: 0,
          children: [],
          childNames: [],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("collection");
      expect(decoded.children).toBeUndefined();
      expect(decoded.childNames).toEqual([]);
    });
  });

  describe("decodeNode", () => {
    it("should decode chunk correctly", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const encoded = await encodeChunk({ data, contentType: "application/octet-stream" }, mockHashProvider);
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("chunk");
      expect(decoded.data).toEqual(data);
      expect(decoded.contentType).toBe("application/octet-stream");
    });

    it("should decode collection correctly", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x55);
      const encoded = await encodeCollection(
        {
          size: 999,
          children: [child],
          childNames: ["test"],
        },
        mockHashProvider
      );
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("collection");
      expect(decoded.size).toBe(999);
      expect(decoded.childNames).toEqual(["test"]);
    });
  });

  describe("isValidNode", () => {
    it("should return true for valid node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeChunk({ data }, mockHashProvider);
      expect(isValidNode(result.bytes)).toBe(true);
    });

    it("should return false for invalid magic", () => {
      const bytes = new Uint8Array(HEADER_SIZE);
      expect(isValidNode(bytes)).toBe(false);
    });

    it("should return false for too small buffer", () => {
      expect(isValidNode(new Uint8Array(16))).toBe(false);
    });
  });

  describe("getNodeKind", () => {
    it("should return chunk for chunk node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeChunk({ data }, mockHashProvider);
      expect(getNodeKind(result.bytes)).toBe("chunk");
    });

    it("should return collection for collection node", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x11);
      const result = await encodeCollection(
        { size: 0, children: [child], childNames: ["x"] },
        mockHashProvider
      );
      expect(getNodeKind(result.bytes)).toBe("collection");
    });

    it("should return null for invalid buffer", () => {
      expect(getNodeKind(new Uint8Array(10))).toBe(null);
    });
  });

  describe("roundtrip with real hash", () => {
    it("should produce consistent hash", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = await encodeChunk({ data }, realHashProvider);
      const result2 = await encodeChunk({ data }, realHashProvider);

      expect(result1.hash).toEqual(result2.hash);
      expect(result1.bytes).toEqual(result2.bytes);
    });

    it("should produce different hash for different data", async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([1, 2, 4]);

      const result1 = await encodeChunk({ data: data1 }, realHashProvider);
      const result2 = await encodeChunk({ data: data2 }, realHashProvider);

      expect(result1.hash).not.toEqual(result2.hash);
    });
  });
});
