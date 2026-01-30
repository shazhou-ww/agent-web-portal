/**
 * CAS Client - Chunker Tests
 */

import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { computeKey, splitIntoChunks, streamToBuffer } from "./chunker.ts";

describe("computeKey", () => {
  it("should compute sha256 hash with prefix", async () => {
    const buffer = Buffer.from("hello world");
    const key = await computeKey(buffer);

    expect(key).toMatch(/^sha256:[a-f0-9]{64}$/);
    // Known hash for "hello world"
    expect(key).toBe("sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9");
  });

  it("should produce different keys for different content", async () => {
    const key1 = await computeKey(Buffer.from("hello"));
    const key2 = await computeKey(Buffer.from("world"));

    expect(key1).not.toBe(key2);
  });

  it("should produce same key for same content", async () => {
    const content = Buffer.from("same content");
    const key1 = await computeKey(content);
    const key2 = await computeKey(content);

    expect(key1).toBe(key2);
  });
});

describe("splitIntoChunks", () => {
  it("should return single chunk for small content", () => {
    const content = Buffer.from("small");
    const chunks = splitIntoChunks(content, 1024);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toEqual(content);
  });

  it("should split large content into chunks", () => {
    const content = Buffer.alloc(2500, "x");
    const chunks = splitIntoChunks(content, 1000);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.length).toBe(1000);
    expect(chunks[1]!.length).toBe(1000);
    expect(chunks[2]!.length).toBe(500);
  });

  it("should preserve content after split", () => {
    const original = Buffer.from("0123456789abcdef");
    const chunks = splitIntoChunks(original, 5);

    const reassembled = Buffer.concat(chunks);
    expect(reassembled.toString()).toBe(original.toString());
  });

  it("should handle exact multiple of threshold", () => {
    const content = Buffer.alloc(1000, "y");
    const chunks = splitIntoChunks(content, 500);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]!.length).toBe(500);
    expect(chunks[1]!.length).toBe(500);
  });
});

describe("streamToBuffer", () => {
  it("should convert stream to buffer", async () => {
    const data = "hello stream";
    const stream = Readable.from([Buffer.from(data)]);

    const buffer = await streamToBuffer(stream);

    expect(buffer.toString()).toBe(data);
  });

  it("should handle multiple chunks in stream", async () => {
    const chunks = ["chunk1", "chunk2", "chunk3"];
    const stream = Readable.from(chunks.map((c) => Buffer.from(c)));

    const buffer = await streamToBuffer(stream);

    expect(buffer.toString()).toBe(chunks.join(""));
  });

  it("should handle empty stream", async () => {
    const stream = Readable.from([]);

    const buffer = await streamToBuffer(stream);

    expect(buffer.length).toBe(0);
  });
});
