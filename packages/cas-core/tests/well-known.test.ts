/**
 * Tests for well-known CAS keys and data (v2.1 format)
 */

import { describe, expect, it } from "bun:test";
import { EMPTY_DICT_BYTES, EMPTY_DICT_KEY, WELL_KNOWN_KEYS } from "../src/well-known.ts";
import { MAGIC, NODE_TYPE, HEADER_SIZE } from "../src/constants.ts";
import { decodeHeader, getNodeType } from "../src/header.ts";

describe("Well-known Keys", () => {
  describe("EMPTY_DICT_BYTES", () => {
    it("should be exactly HEADER_SIZE bytes", () => {
      expect(EMPTY_DICT_BYTES.length).toBe(HEADER_SIZE);
    });

    it("should have correct magic number", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(0, true)).toBe(MAGIC);
    });

    it("should have d-node type flag", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      const flags = view.getUint32(4, true);
      expect(flags & 0b11).toBe(NODE_TYPE.DICT);
    });

    it("should have size = 0 at offset 8 (u32)", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(8, true)).toBe(0);
    });

    it("should have count = 0 at offset 12", () => {
      const view = new DataView(EMPTY_DICT_BYTES.buffer);
      expect(view.getUint32(12, true)).toBe(0);
    });

    it("should have reserved bytes = 0 at offset 16-31", () => {
      for (let i = 16; i < 32; i++) {
        expect(EMPTY_DICT_BYTES[i]).toBe(0);
      }
    });

    it("should decode correctly as a d-node header", () => {
      const header = decodeHeader(EMPTY_DICT_BYTES);
      expect(header.count).toBe(0);
      expect(header.size).toBe(0);
      expect(getNodeType(header.flags)).toBe(NODE_TYPE.DICT);
    });
  });

  describe("EMPTY_DICT_KEY", () => {
    it("should be a valid sha256 key format", () => {
      expect(EMPTY_DICT_KEY).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should match the hash of EMPTY_DICT_BYTES", async () => {
      const hash = await crypto.subtle.digest("SHA-256", EMPTY_DICT_BYTES);
      const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(EMPTY_DICT_KEY).toBe(`sha256:${hashHex}`);
    });
  });

  describe("WELL_KNOWN_KEYS", () => {
    it("should export EMPTY_DICT key", () => {
      expect(WELL_KNOWN_KEYS.EMPTY_DICT).toBe(EMPTY_DICT_KEY);
    });
  });
});
