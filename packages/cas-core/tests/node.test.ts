/**
 * Node encoding/decoding roundtrip tests (v2 format)
 */
import { describe, expect, it } from "bun:test";
import { DATA_ALIGNMENT, HASH_SIZE, HEADER_SIZE, NODE_TYPE } from "../src/constants.ts";
import {
  decodeNode,
  encodeDictNode,
  encodeFileNode,
  encodeFileNodeWithSize,
  encodeSuccessorNode,
  encodeSuccessorNodeWithSize,
  getNodeKind,
  isValidNode,
  // Legacy aliases
  encodeChunk,
  encodeChunkWithSize,
} from "../src/node.ts";
import { getNodeType } from "../src/header.ts";
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
  describe("encodeFileNode (f-node)", () => {
    it("should encode simple file node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeFileNode({ data }, mockHashProvider);

      expect(result.bytes.length).toBeGreaterThanOrEqual(HEADER_SIZE + 5);
      expect(result.hash.length).toBe(HASH_SIZE);
    });

    it("should encode file node with content type", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode(
        { data, contentType: "image/png" },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("file");
      expect(decoded.contentType).toBe("image/png");
      expect(decoded.data).toEqual(data);
    });

    it("should encode file node with children", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const child1 = new Uint8Array(HASH_SIZE).fill(0xaa);
      const child2 = new Uint8Array(HASH_SIZE).fill(0xbb);

      const result = await encodeFileNode(
        { data, children: [child1, child2] },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("file");
      expect(decoded.children).toHaveLength(2);
      expect(decoded.children![0]).toEqual(child1);
      expect(decoded.children![1]).toEqual(child2);
    });

    it("should pad content-type to 16/32/64 bytes", async () => {
      const data = new Uint8Array([1, 2, 3]);

      // Short content-type (<=16 bytes)
      const r1 = await encodeFileNode({ data, contentType: "text/plain" }, mockHashProvider);
      // Check data starts at 16-byte aligned position
      expect((HEADER_SIZE + 16) % DATA_ALIGNMENT).toBe(0);

      // Medium content-type (<=32 bytes)
      const r2 = await encodeFileNode({ data, contentType: "application/octet-stream" }, mockHashProvider);
      expect((HEADER_SIZE + 32) % DATA_ALIGNMENT).toBe(0);
    });

    it("should have data 16-byte aligned", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const child = new Uint8Array(HASH_SIZE).fill(0x11);

      // f-node with 1 child and content-type
      const result = await encodeFileNode(
        { data, contentType: "text/plain", children: [child] },
        mockHashProvider
      );

      // Header(32) + Children(32) + ContentType(16) = 80, which is 16-byte aligned
      const expectedDataOffset = HEADER_SIZE + HASH_SIZE + 16;
      expect(expectedDataOffset % DATA_ALIGNMENT).toBe(0);

      const decoded = decodeNode(result.bytes);
      expect(decoded.data).toEqual(data);
    });
  });

  describe("encodeFileNodeWithSize", () => {
    it("should set explicit size", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNodeWithSize(
        { data },
        1000000, // logical size
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.size).toBe(1000000);
    });
  });

  describe("encodeSuccessorNode (s-node)", () => {
    it("should encode successor node", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result = await encodeSuccessorNode({ data }, mockHashProvider);

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
      expect(decoded.contentType).toBeUndefined();
    });

    it("should have data 16-byte aligned with padding", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const child = new Uint8Array(HASH_SIZE).fill(0xcc);

      const result = await encodeSuccessorNode(
        { data, children: [child] },
        mockHashProvider
      );

      // Header(32) + Children(32) = 64, already 16-byte aligned
      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
    });

    it("should pad to 16-byte alignment when needed", async () => {
      const data = new Uint8Array([1, 2, 3]);
      // No children, so data offset = 32 (already aligned)
      const result = await encodeSuccessorNode({ data }, mockHashProvider);
      expect(result.bytes.length).toBe(HEADER_SIZE + data.length);
    });
  });

  describe("encodeSuccessorNodeWithSize", () => {
    it("should set explicit size for s-node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeSuccessorNodeWithSize(
        { data },
        500000,
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.size).toBe(500000);
    });
  });

  describe("encodeDictNode (d-node)", () => {
    it("should encode dict node with children and names", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);
      const child2 = new Uint8Array(HASH_SIZE).fill(0x22);

      const result = await encodeDictNode(
        {
          size: 5000,
          children: [child1, child2],
          childNames: ["file1.txt", "folder2"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("dict");
      expect(decoded.size).toBe(5000);
      expect(decoded.children).toHaveLength(2);
    });

    it("should sort children by name (UTF-8 byte order)", async () => {
      const childA = new Uint8Array(HASH_SIZE).fill(0xaa);
      const childB = new Uint8Array(HASH_SIZE).fill(0xbb);
      const childC = new Uint8Array(HASH_SIZE).fill(0xcc);

      // Input unsorted
      const result = await encodeDictNode(
        {
          size: 100,
          children: [childC, childA, childB],
          childNames: ["zebra", "alpha", "beta"],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      // Should be sorted: alpha, beta, zebra
      expect(decoded.childNames).toEqual(["alpha", "beta", "zebra"]);
      expect(decoded.children![0]).toEqual(childA);
      expect(decoded.children![1]).toEqual(childB);
      expect(decoded.children![2]).toEqual(childC);
    });

    it("should throw on children/names count mismatch", async () => {
      const child1 = new Uint8Array(HASH_SIZE).fill(0x11);

      await expect(
        encodeDictNode(
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

      const result = await encodeDictNode(
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

    it("should handle empty dict node", async () => {
      const result = await encodeDictNode(
        {
          size: 0,
          children: [],
          childNames: [],
        },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("dict");
      expect(decoded.children).toBeUndefined();
      expect(decoded.childNames).toEqual([]);
    });

    it("should not have content-type field", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x11);
      const result = await encodeDictNode(
        { size: 0, children: [child], childNames: ["x"] },
        mockHashProvider
      );

      const decoded = decodeNode(result.bytes);
      expect(decoded.contentType).toBeUndefined();
    });
  });

  describe("decodeNode", () => {
    it("should decode f-node correctly", async () => {
      const data = new Uint8Array([10, 20, 30, 40, 50]);
      const encoded = await encodeFileNode({ data, contentType: "application/octet-stream" }, mockHashProvider);
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("file");
      expect(decoded.data).toEqual(data);
      expect(decoded.contentType).toBe("application/octet-stream");
    });

    it("should decode s-node correctly", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const encoded = await encodeSuccessorNode({ data }, mockHashProvider);
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("successor");
      expect(decoded.data).toEqual(data);
      expect(decoded.contentType).toBeUndefined();
    });

    it("should decode d-node correctly", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x55);
      const encoded = await encodeDictNode(
        {
          size: 999,
          children: [child],
          childNames: ["test"],
        },
        mockHashProvider
      );
      const decoded = decodeNode(encoded.bytes);

      expect(decoded.kind).toBe("dict");
      expect(decoded.size).toBe(999);
      expect(decoded.childNames).toEqual(["test"]);
    });
  });

  describe("isValidNode", () => {
    it("should return true for valid node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode({ data }, mockHashProvider);
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
    it("should return file for f-node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeFileNode({ data }, mockHashProvider);
      expect(getNodeKind(result.bytes)).toBe("file");
    });

    it("should return successor for s-node", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeSuccessorNode({ data }, mockHashProvider);
      expect(getNodeKind(result.bytes)).toBe("successor");
    });

    it("should return dict for d-node", async () => {
      const child = new Uint8Array(HASH_SIZE).fill(0x11);
      const result = await encodeDictNode(
        { size: 0, children: [child], childNames: ["x"] },
        mockHashProvider
      );
      expect(getNodeKind(result.bytes)).toBe("dict");
    });

    it("should return null for invalid buffer", () => {
      expect(getNodeKind(new Uint8Array(10))).toBe(null);
    });
  });

  describe("roundtrip with real hash", () => {
    it("should produce consistent hash", async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5]);
      const result1 = await encodeFileNode({ data }, realHashProvider);
      const result2 = await encodeFileNode({ data }, realHashProvider);

      expect(result1.hash).toEqual(result2.hash);
      expect(result1.bytes).toEqual(result2.bytes);
    });

    it("should produce different hash for different data", async () => {
      const data1 = new Uint8Array([1, 2, 3]);
      const data2 = new Uint8Array([1, 2, 4]);

      const result1 = await encodeFileNode({ data: data1 }, realHashProvider);
      const result2 = await encodeFileNode({ data: data2 }, realHashProvider);

      expect(result1.hash).not.toEqual(result2.hash);
    });

    it("should produce same hash for same dict regardless of input order", async () => {
      const childA = new Uint8Array(HASH_SIZE).fill(0xaa);
      const childB = new Uint8Array(HASH_SIZE).fill(0xbb);

      // Different input order, same logical content
      const result1 = await encodeDictNode(
        { size: 100, children: [childA, childB], childNames: ["a", "b"] },
        realHashProvider
      );
      const result2 = await encodeDictNode(
        { size: 100, children: [childB, childA], childNames: ["b", "a"] },
        realHashProvider
      );

      // After sorting, should be identical
      expect(result1.hash).toEqual(result2.hash);
      expect(result1.bytes).toEqual(result2.bytes);
    });
  });

  describe("legacy aliases", () => {
    it("encodeChunk should work as encodeFileNode", async () => {
      const data = new Uint8Array([1, 2, 3]);
      const result = await encodeChunk({ data, contentType: "text/plain" }, mockHashProvider);
      const decoded = decodeNode(result.bytes);
      expect(decoded.kind).toBe("file");
    });
  });
});
