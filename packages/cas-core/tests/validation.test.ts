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

    it("should reject truncated buffer (length mismatch)", async () => {
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
      expect(result.error).toContain("Length mismatch");
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

    it("should reject unknown node type", () => {
      // Create a valid-looking header with node type = 0b00 (invalid)
      const bytes = new Uint8Array(32);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0 (invalid node type)
      bytes[4] = 0;
      // size = 0
      // count = 0
      // length = 32
      const view = new DataView(bytes.buffer);
      view.setUint32(20, 32, true);

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown node type");
    });

    it("should reject reserved bytes not zero", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]) },
        hashProvider
      );

      // Corrupt reserved bytes (offset 24-31)
      const corrupted = new Uint8Array(encoded.bytes);
      corrupted[24] = 0xff;

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Reserved bytes not zero");
    });

    it("should reject dict with unsorted children names", async () => {
      const child1 = await encodeFileNode({ data: new Uint8Array([1]) }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array([2]) }, hashProvider);

      // Create a dict node manually with unsorted names
      const encoded = await encodeDictNode(
        {
          size: 2,
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"], // sorted
        },
        hashProvider
      );

      // Manually corrupt the names to be unsorted by swapping them
      // Find the names section and swap
      const bytes = new Uint8Array(encoded.bytes);
      // Names start at offset 32 + 64 = 96
      // First name "a.txt": 2 bytes length + 5 bytes = 7 bytes
      // Second name "b.txt": 2 bytes length + 5 bytes = 7 bytes
      // Swap: make first name "z.txt"
      bytes[98] = 0x7a; // 'z' instead of 'a'

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not sorted");
    });

    it("should reject Pascal string exceeding buffer", () => {
      // Create a d-node with count=1 but Pascal string length pointing beyond buffer
      const bytes = new Uint8Array(40);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b01 (d-node)
      bytes[4] = 0b01;
      // size = 0
      // count = 1
      const view = new DataView(bytes.buffer);
      view.setUint32(16, 1, true);
      // length = 40
      view.setUint32(20, 40, true);

      // Add a fake child hash (32 bytes starting at offset 32)
      // But wait, we only have 40 bytes, so child hash at 32-63 won't fit
      // Let's use 72 bytes instead
      const bytes2 = new Uint8Array(72);
      bytes2.set(bytes.slice(0, 32));
      const view2 = new DataView(bytes2.buffer);
      view2.setUint32(20, 72, true);
      // child hash at 32-63 (zeros)
      // Pascal string at 64: length=1000 (exceeds buffer)
      view2.setUint16(64, 1000, true);

      const result = validateNodeStructure(bytes2);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Pascal string");
    });

    it("should reject invalid UTF-8 in Pascal string", () => {
      // Create a d-node with invalid UTF-8 in name
      const bytes = new Uint8Array(72);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b01 (d-node)
      bytes[4] = 0b01;
      // size = 0, count = 1, length = 72
      const view = new DataView(bytes.buffer);
      view.setUint32(16, 1, true);
      view.setUint32(20, 72, true);
      // child hash at 32-63 (zeros)
      // Pascal string at 64: length=4, then invalid UTF-8
      view.setUint16(64, 4, true);
      bytes[66] = 0xff; // Invalid UTF-8 start byte
      bytes[67] = 0xfe;
      bytes[68] = 0x00;
      bytes[69] = 0x00;

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Invalid UTF-8");
    });

    it("should reject non-file node with CT_LENGTH != 0", () => {
      // Create a d-node but with CT_LENGTH bits set (should be 0)
      const bytes = new Uint8Array(32);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b0101 (d-node with CT_LENGTH=16 set incorrectly)
      bytes[4] = 0b0101;
      // size = 0, count = 0, length = 32
      const view = new DataView(bytes.buffer);
      view.setUint32(20, 32, true);

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Non-file node must have CT_LENGTH=0");
    });

    it("should reject s-node with CT_LENGTH != 0", () => {
      // Create an s-node but with CT_LENGTH bits set
      const bytes = new Uint8Array(32);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b1010 (s-node with CT_LENGTH=32 set incorrectly)
      bytes[4] = 0b1010;
      // size = 0, count = 0, length = 32
      const view = new DataView(bytes.buffer);
      view.setUint32(20, 32, true);

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Non-file node must have CT_LENGTH=0");
    });

    it("should reject f-node with over-allocated content-type slot", async () => {
      // Create an f-node with short content-type but 32-byte slot
      const data = new Uint8Array([1, 2, 3]);

      // First create a valid node
      const validNode = await encodeFileNode(
        { data, contentType: "text/plain" }, // 10 bytes, should use 16-byte slot
        hashProvider
      );

      // Manually corrupt: change CT_LENGTH from 16 to 32
      const corrupted = new Uint8Array(validNode.bytes.length + 16); // Extra 16 bytes for larger slot
      corrupted.set(validNode.bytes);

      // Modify flags: change from CT_LENGTH=16 (01) to CT_LENGTH=32 (10)
      // Current flags should be 0b0111 (f-node + CT16), change to 0b1011 (f-node + CT32)
      corrupted[4] = 0b1011;

      // Update length field
      const view = new DataView(corrupted.buffer);
      view.setUint32(20, corrupted.length, true);

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("over-allocated");
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
