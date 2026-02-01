/**
 * Header encoding/decoding tests
 */
import { describe, expect, it } from "bun:test";
import { HEADER_SIZE, MAGIC } from "../src/constants.ts";
import { decodeHeader, encodeHeader } from "../src/header.ts";
import type { CasHeader } from "../src/types.ts";

describe("Header", () => {
  describe("encodeHeader", () => {
    it("should produce 32 bytes", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        count: 0,
        size: 0,
        namesOffset: 0,
        typeOffset: 0,
        dataOffset: 0,
      };
      const bytes = encodeHeader(header);
      expect(bytes.length).toBe(HEADER_SIZE);
    });

    it("should encode magic correctly", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        count: 0,
        size: 0,
        namesOffset: 0,
        typeOffset: 0,
        dataOffset: 0,
      };
      const bytes = encodeHeader(header);
      // "CAS\x01" in LE
      expect(bytes[0]).toBe(0x43); // 'C'
      expect(bytes[1]).toBe(0x41); // 'A'
      expect(bytes[2]).toBe(0x53); // 'S'
      expect(bytes[3]).toBe(0x01); // version
    });

    it("should encode size as u64 LE", () => {
      const header: CasHeader = {
        magic: MAGIC,
        flags: 0,
        count: 0,
        size: 0x123456789ABC, // > 32 bits
        namesOffset: 0,
        typeOffset: 0,
        dataOffset: 0,
      };
      const bytes = encodeHeader(header);
      const view = new DataView(bytes.buffer);
      const low = view.getUint32(12, true);
      const high = view.getUint32(16, true);
      expect(low + high * 0x100000000).toBe(0x123456789ABC);
    });
  });

  describe("decodeHeader", () => {
    it("should roundtrip header correctly", () => {
      const original: CasHeader = {
        magic: MAGIC,
        flags: 7,
        count: 42,
        size: 1024 * 1024,
        namesOffset: 100,
        typeOffset: 200,
        dataOffset: 300,
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
        count: 0,
        size: Number.MAX_SAFE_INTEGER,
        namesOffset: 0,
        typeOffset: 0,
        dataOffset: 0,
      };
      const bytes = encodeHeader(original);
      const decoded = decodeHeader(bytes);
      expect(decoded.size).toBe(Number.MAX_SAFE_INTEGER);
    });
  });
});
