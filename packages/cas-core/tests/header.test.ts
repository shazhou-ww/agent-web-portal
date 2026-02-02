/**
 * Header encoding/decoding tests (v2 format)
 */
import { describe, expect, it } from "bun:test";
import { HEADER_SIZE, MAGIC, NODE_TYPE } from "../src/constants.ts";
import {
  createDictHeader,
  createFileHeader,
  createSuccessorHeader,
  decodeHeader,
  encodeHeader,
  getContentTypeLength,
  getNodeType,
} from "../src/header.ts";
import type { CasHeader } from "../src/types.ts";

describe("Header", () => {
  describe("encodeHeader", () => {
    it("should produce 32 bytes", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 0,
        length: 32,
      };
      const bytes = encodeHeader(header);
      expect(bytes.length).toBe(HEADER_SIZE);
    });

    it("should encode magic correctly", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 0,
        length: 32,
      };
      const bytes = encodeHeader(header);
      // "CAS\x01" in LE
      expect(bytes[0]).toBe(0x43); // 'C'
      expect(bytes[1]).toBe(0x41); // 'A'
      expect(bytes[2]).toBe(0x53); // 'S'
      expect(bytes[3]).toBe(0x01); // version
    });

    it("should encode size as u64 LE at offset 8", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0x123456789ABC, // > 32 bits
        count: 0,
        length: 32,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      const low = view.getUint32(8, true);
      const high = view.getUint32(12, true);
      expect(low + high * 0x100000000).toBe(0x123456789ABC);
    });

    it("should encode count at offset 16", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 42,
        length: 32,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(16, true)).toBe(42);
    });

    it("should encode length at offset 20", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: 0,
        count: 0,
        length: 1024,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(20, true)).toBe(1024);
    });

    it("should have reserved bytes = 0 at offset 24-31", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0b1111,
        size: 12345,
        count: 10,
        length: 1000,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      expect(view.getUint32(24, true)).toBe(0);
      expect(view.getUint32(28, true)).toBe(0);
    });
  });

  describe("decodeHeader", () => {
    it("should roundtrip header correctly", () => {
      const original: CasHeader = {
        magic: MAGIC,
        flags: 0b1111,
        size: 1024 * 1024,
        count: 42,
        length: 2048,
      };
      const bytes = encodeHeader(original);
      const decoded = decodeHeader(bytes);
      expect(decoded).toEqual(original);
    });

    it("should throw on invalid magic", () => {
      const bytes = new Uint8Array(32);
      bytes[0] = 0x00;
      expect(() => decodeHeader(bytes)).toThrow(/Invalid magic/);
    });

    it("should throw on buffer too small", () => {
      const bytes = new Uint8Array(16);
      expect(() => decodeHeader(bytes)).toThrow(/Buffer too small/);
    });

    it("should handle large sizes correctly", () => {
      const original: CasHeader = {
        magic: MAGIC,
        flags: 0,
        size: Number.MAX_SAFE_INTEGER,
        count: 0,
        length: 32,
      };
      const bytes = encodeHeader(original);
      const decoded = decodeHeader(bytes);
      expect(decoded.size).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  describe("node type helpers", () => {
    it("should create d-node header", () => {
      const header = createDictHeader(100, 5, 200);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.DICT);
      expect(header.size).toBe(100);
      expect(header.count).toBe(5);
      expect(header.length).toBe(200);
    });

    it("should create s-node header", () => {
      const header = createSuccessorHeader(100, 2, 164);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.SUCCESSOR);
      expect(header.size).toBe(100);
      expect(header.count).toBe(2);
      expect(header.length).toBe(164);
    });

    it("should create f-node header with content-type length", () => {
      const header = createFileHeader(100, 2, 180, 16);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.FILE);
      expect(getContentTypeLength(header.flags)).toBe(16);
      expect(header.size).toBe(100);
      expect(header.count).toBe(2);
      expect(header.length).toBe(180);
    });

    it("should create f-node header with different content-type lengths", () => {
      expect(getContentTypeLength(createFileHeader(0, 0, 32, 0).flags)).toBe(0);
      expect(getContentTypeLength(createFileHeader(0, 0, 48, 16).flags)).toBe(16);
      expect(getContentTypeLength(createFileHeader(0, 0, 64, 32).flags)).toBe(32);
      expect(getContentTypeLength(createFileHeader(0, 0, 96, 64).flags)).toBe(64);
    });
  });
});
