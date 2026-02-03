/**
 * Validation tests (v2.1 format)
 */

import { describe, expect, it } from "bun:test";
import { FILEINFO_SIZE, HASH_SIZE, HEADER_SIZE, MAGIC } from "../src/constants.ts";
import { encodeDictNode, encodeFileNode, encodeSuccessorNode } from "../src/node.ts";
import { createMemoryStorage, createWebCryptoHash } from "../src/providers.ts";
import { validateNode, validateNodeStructure } from "../src/validation.ts";
import { hashToKey } from "../src/utils.ts";

const hashProvider = createWebCryptoHash();

describe("Validation", () => {
  describe("validateNodeStructure", () => {
    it("should validate correct file node", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain", fileSize: 3 },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("file");
      // size is now payload size (FileInfo + data = 64 + 3 = 67)
      expect(result.size).toBe(FILEINFO_SIZE + 3);
      expect(result.childKeys).toEqual([]);
    });

    it("should validate correct dict node", async () => {
      // First create some children
      const child1 = await encodeFileNode({ data: new Uint8Array([1]), fileSize: 1 }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array([2]), fileSize: 1 }, hashProvider);

      const encoded = await encodeDictNode(
        {
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("dict");
      expect(result.childKeys).toHaveLength(2);
    });

    it("should validate correct successor node", async () => {
      const encoded = await encodeSuccessorNode(
        { data: new Uint8Array([1, 2, 3, 4, 5]) },
        hashProvider
      );

      const result = validateNodeStructure(encoded.bytes);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("successor");
      expect(result.size).toBe(5); // data size only
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
          children: [new Uint8Array(32)],
          fileSize: 100,
        },
        hashProvider
      );

      // Truncate to remove some data
      const truncated = encoded.bytes.slice(0, 80);
      const result = validateNodeStructure(truncated);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Length mismatch");
    });

    it("should validate unicode names in dict node", async () => {
      const child = await encodeFileNode({ data: new Uint8Array([1]), fileSize: 1 }, hashProvider);

      const encoded = await encodeDictNode(
        {
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
      // size = 0, count = 0

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Unknown node type");
    });

    it("should reject reserved bytes not zero", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), fileSize: 3 },
        hashProvider
      );

      // Corrupt reserved bytes (offset 16-31)
      const corrupted = new Uint8Array(encoded.bytes);
      corrupted[20] = 0xff;

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not zero");
    });

    it("should reject dict with unsorted children names", async () => {
      const child1 = await encodeFileNode({ data: new Uint8Array([1]), fileSize: 1 }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array([2]), fileSize: 1 }, hashProvider);

      // Create a dict node with sorted names
      const encoded = await encodeDictNode(
        {
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      // Manually corrupt the names to be unsorted by changing first name to "z.txt"
      const bytes = new Uint8Array(encoded.bytes);
      // Names start after header(32) + children(64) = 96
      // First name: 2 bytes length + 5 bytes "a.txt"
      bytes[98] = 0x7a; // 'z' instead of 'a'

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("not sorted");
    });

    it("should reject flags with unused bits set", () => {
      // Create a valid-looking f-node but with unused flag bits set (bits 2-31)
      const bytes = new Uint8Array(HEADER_SIZE + FILEINFO_SIZE + 3);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b00010011 (f-node with bit 4 set, which should be 0)
      bytes[4] = 0b00010011;
      // size = 67 (FileInfo + 3 bytes data), count = 0
      const view = new DataView(bytes.buffer);
      view.setUint32(8, FILEINFO_SIZE + 3, true);

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("unused bits set");
    });

    it("should reject f-node with size < FILEINFO_SIZE", () => {
      // Create an f-node with size too small for FileInfo
      const bytes = new Uint8Array(HEADER_SIZE + 10);
      // Magic: "CAS\x01"
      bytes[0] = 0x43;
      bytes[1] = 0x41;
      bytes[2] = 0x53;
      bytes[3] = 0x01;
      // Flags = 0b11 (f-node)
      bytes[4] = 0b11;
      // size = 10 (less than FILEINFO_SIZE=64)
      const view = new DataView(bytes.buffer);
      view.setUint32(8, 10, true);
      view.setUint32(12, 0, true); // count = 0

      const result = validateNodeStructure(bytes);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("too small for FileInfo");
    });

    it("should reject content-type with non-printable ASCII", async () => {
      const validNode = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain", fileSize: 3 },
        hashProvider
      );

      // Corrupt the contentType area with non-printable character
      const corrupted = new Uint8Array(validNode.bytes);
      // ContentType starts at Header(32) + fileSize(8) = 40
      corrupted[40] = 0x01; // Non-printable ASCII

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("invalid character");
    });

    it("should reject content-type padding with non-zero bytes", async () => {
      const validNode = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain", fileSize: 3 },
        hashProvider
      );

      // Corrupt the padding area after contentType
      const corrupted = new Uint8Array(validNode.bytes);
      // ContentType slot is 56 bytes starting at offset 40
      // "text/plain" is 10 bytes, so padding starts at 50
      corrupted[90] = 0xff; // Should be 0x00

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("padding");
    });

    it("should reject duplicate child names in d-node", async () => {
      const child1 = await encodeFileNode({ data: new Uint8Array([1]), fileSize: 1 }, hashProvider);
      const child2 = await encodeFileNode({ data: new Uint8Array([2]), fileSize: 1 }, hashProvider);

      // Create a d-node with sorted names
      const validNode = await encodeDictNode(
        {
          children: [child1.hash, child2.hash],
          childNames: ["a.txt", "b.txt"],
        },
        hashProvider
      );

      // Corrupt second name to match first ("a.txt" -> "a.txt")
      const corrupted = new Uint8Array(validNode.bytes);
      // Children end at 32 + 64 = 96
      // First name: 2 bytes len + "a.txt" = 7 bytes (offset 96-102)
      // Second name starts at 103: 2 bytes len + "b.txt"
      // Change "b" to "a" at offset 105
      corrupted[105] = 0x61; // 'a' instead of 'b'

      const result = validateNodeStructure(corrupted);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Duplicate child name");
    });
  });

  describe("validateNode", () => {
    it("should validate hash matches", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), contentType: "text/plain", fileSize: 3 },
        hashProvider
      );
      const key = hashToKey(encoded.hash);

      const result = await validateNode(encoded.bytes, key, hashProvider);
      expect(result.valid).toBe(true);
      expect(result.kind).toBe("file");
    });

    it("should reject hash mismatch", async () => {
      const encoded = await encodeFileNode(
        { data: new Uint8Array([1, 2, 3]), fileSize: 3 },
        hashProvider
      );

      // Use wrong key
      const wrongKey = "sha256:0000000000000000000000000000000000000000000000000000000000000000";
      const result = await validateNode(encoded.bytes, wrongKey, hashProvider);
      expect(result.valid).toBe(false);
      expect(result.error).toContain("Hash mismatch");
    });

    it("should check children existence", async () => {
      const child = await encodeFileNode({ data: new Uint8Array([1]), fileSize: 1 }, hashProvider);
      const childKey = hashToKey(child.hash);

      const storage = createMemoryStorage();
      await storage.put(childKey, child.bytes);

      const dict = await encodeDictNode(
        {
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
  });
});
