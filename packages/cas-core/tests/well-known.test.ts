/**
 * Tests for well-known CAS keys and data
 */

import { describe, expect, it } from "bun:test";
import { EMPTY_COLLECTION_BYTES, EMPTY_COLLECTION_KEY, WELL_KNOWN_KEYS } from "../src/well-known.ts";
import { MAGIC, FLAGS, HEADER_SIZE } from "../src/constants.ts";
import { decodeHeader } from "../src/header.ts";

describe("Well-known Keys", () => {
  describe("EMPTY_COLLECTION_BYTES", () => {
    it("should be exactly HEADER_SIZE bytes", () => {
      expect(EMPTY_COLLECTION_BYTES.length).toBe(HEADER_SIZE);
    });

    it("should have correct magic number", () => {
      const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
      expect(view.getUint32(0, true)).toBe(MAGIC);
    });

    it("should have HAS_NAMES flag", () => {
      const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
      expect(view.getUint32(4, true)).toBe(FLAGS.HAS_NAMES);
    });

    it("should have count = 0", () => {
      const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
      expect(view.getUint32(8, true)).toBe(0);
    });

    it("should have size = 0", () => {
      const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
      expect(view.getBigUint64(16, true)).toBe(0n);
    });

    it("should have namesOffset = HEADER_SIZE", () => {
      const view = new DataView(EMPTY_COLLECTION_BYTES.buffer);
      expect(view.getUint32(24, true)).toBe(HEADER_SIZE);
    });

    it("should decode correctly as a collection header", () => {
      const header = decodeHeader(EMPTY_COLLECTION_BYTES);
      expect(header.count).toBe(0);
      expect(header.size).toBe(0);
      expect(header.flags & FLAGS.HAS_NAMES).toBe(FLAGS.HAS_NAMES);
      expect(header.flags & FLAGS.HAS_DATA).toBe(0);
    });
  });

  describe("EMPTY_COLLECTION_KEY", () => {
    it("should be a valid sha256 key format", () => {
      expect(EMPTY_COLLECTION_KEY).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it("should match the hash of EMPTY_COLLECTION_BYTES", async () => {
      const hash = await crypto.subtle.digest("SHA-256", EMPTY_COLLECTION_BYTES);
      const hashHex = Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      expect(EMPTY_COLLECTION_KEY).toBe(`sha256:${hashHex}`);
    });
  });

  describe("WELL_KNOWN_KEYS", () => {
    it("should export EMPTY_COLLECTION key", () => {
      expect(WELL_KNOWN_KEYS.EMPTY_COLLECTION).toBe(EMPTY_COLLECTION_KEY);
    });
  });
});
