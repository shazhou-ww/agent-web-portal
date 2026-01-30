/**
 * CAS Client - FileHandle Tests
 */

import { describe, expect, it } from "bun:test";
import { Readable } from "node:stream";
import { CasFileHandleImpl } from "./file-handle.ts";
import type { CasRawFileNode } from "./types.ts";

// Helper to read stream to buffer
async function readStream(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

// Mock chunk fetcher
const createMockFetcher = (chunks: Map<string, Buffer>) => {
  return async (key: string): Promise<Readable> => {
    const data = chunks.get(key);
    if (!data) {
      throw new Error(`Chunk not found: ${key}`);
    }
    return Readable.from([data]);
  };
};

describe("CasFileHandleImpl", () => {
  const singleChunkNode: CasRawFileNode = {
    kind: "file",
    key: "sha256:file1",
    contentType: "text/plain",
    size: 11,
    chunks: ["sha256:chunk1"],
    chunkSizes: [11],
  };

  const multiChunkNode: CasRawFileNode = {
    kind: "file",
    key: "sha256:file2",
    contentType: "application/octet-stream",
    size: 30,
    chunks: ["sha256:chunk1", "sha256:chunk2", "sha256:chunk3"],
    chunkSizes: [10, 10, 10],
  };

  describe("properties", () => {
    it("should expose key, size, and contentType", () => {
      const chunks = new Map([["sha256:chunk1", Buffer.from("hello world")]]);
      const handle = new CasFileHandleImpl(singleChunkNode, createMockFetcher(chunks));

      expect(handle.key).toBe("sha256:file1");
      expect(handle.size).toBe(11);
      expect(handle.contentType).toBe("text/plain");
    });
  });

  describe("buffer", () => {
    it("should read single chunk file to buffer", async () => {
      const chunks = new Map([["sha256:chunk1", Buffer.from("hello world")]]);
      const handle = new CasFileHandleImpl(singleChunkNode, createMockFetcher(chunks));

      const buffer = await handle.buffer();

      expect(buffer.toString()).toBe("hello world");
    });

    it("should read multi-chunk file to buffer", async () => {
      const chunks = new Map([
        ["sha256:chunk1", Buffer.from("0123456789")],
        ["sha256:chunk2", Buffer.from("abcdefghij")],
        ["sha256:chunk3", Buffer.from("ABCDEFGHIJ")],
      ]);
      const handle = new CasFileHandleImpl(multiChunkNode, createMockFetcher(chunks));

      const buffer = await handle.buffer();

      expect(buffer.toString()).toBe("0123456789abcdefghijABCDEFGHIJ");
    });
  });

  describe("stream", () => {
    it("should stream single chunk file", async () => {
      const chunks = new Map([["sha256:chunk1", Buffer.from("hello world")]]);
      const handle = new CasFileHandleImpl(singleChunkNode, createMockFetcher(chunks));

      const stream = await handle.stream();
      const result: Buffer[] = [];

      for await (const chunk of stream) {
        result.push(chunk as Buffer);
      }

      expect(Buffer.concat(result).toString()).toBe("hello world");
    });

    it("should stream multi-chunk file in order", async () => {
      const chunks = new Map([
        ["sha256:chunk1", Buffer.from("AAA")],
        ["sha256:chunk2", Buffer.from("BBB")],
        ["sha256:chunk3", Buffer.from("CCC")],
      ]);
      const node: CasRawFileNode = {
        kind: "file",
        key: "sha256:test",
        contentType: "text/plain",
        size: 9,
        chunks: ["sha256:chunk1", "sha256:chunk2", "sha256:chunk3"],
        chunkSizes: [3, 3, 3],
      };
      const handle = new CasFileHandleImpl(node, createMockFetcher(chunks));

      const stream = await handle.stream();
      const result: Buffer[] = [];

      for await (const chunk of stream) {
        result.push(chunk as Buffer);
      }

      expect(Buffer.concat(result).toString()).toBe("AAABBBCCC");
    });
  });

  describe("slice", () => {
    it("should slice within single chunk", async () => {
      const chunks = new Map([["sha256:chunk1", Buffer.from("hello world")]]);
      const handle = new CasFileHandleImpl(singleChunkNode, createMockFetcher(chunks));

      const stream = await handle.slice(0, 5);
      const buffer = await readStream(stream);

      expect(buffer.toString()).toBe("hello");
    });

    it("should slice from middle of file", async () => {
      const chunks = new Map([["sha256:chunk1", Buffer.from("hello world")]]);
      const handle = new CasFileHandleImpl(singleChunkNode, createMockFetcher(chunks));

      const stream = await handle.slice(6, 11);
      const buffer = await readStream(stream);

      expect(buffer.toString()).toBe("world");
    });

    it("should slice across multiple chunks", async () => {
      const chunks = new Map([
        ["sha256:chunk1", Buffer.from("0123456789")],
        ["sha256:chunk2", Buffer.from("abcdefghij")],
        ["sha256:chunk3", Buffer.from("ABCDEFGHIJ")],
      ]);
      const handle = new CasFileHandleImpl(multiChunkNode, createMockFetcher(chunks));

      // Slice from middle of chunk1 to middle of chunk2
      const stream = await handle.slice(5, 15);
      const buffer = await readStream(stream);

      expect(buffer.toString()).toBe("56789abcde");
    });

    it("should handle slice at chunk boundary", async () => {
      const chunks = new Map([
        ["sha256:chunk1", Buffer.from("0123456789")],
        ["sha256:chunk2", Buffer.from("abcdefghij")],
        ["sha256:chunk3", Buffer.from("ABCDEFGHIJ")],
      ]);
      const handle = new CasFileHandleImpl(multiChunkNode, createMockFetcher(chunks));

      // Exactly chunk2
      const stream = await handle.slice(10, 20);
      const buffer = await readStream(stream);

      expect(buffer.toString()).toBe("abcdefghij");
    });

    it("should handle slice spanning all chunks", async () => {
      const chunks = new Map([
        ["sha256:chunk1", Buffer.from("0123456789")],
        ["sha256:chunk2", Buffer.from("abcdefghij")],
        ["sha256:chunk3", Buffer.from("ABCDEFGHIJ")],
      ]);
      const handle = new CasFileHandleImpl(multiChunkNode, createMockFetcher(chunks));

      const stream = await handle.slice(0, 30);
      const buffer = await readStream(stream);

      expect(buffer.toString()).toBe("0123456789abcdefghijABCDEFGHIJ");
    });
  });
});
