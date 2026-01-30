/**
 * CAS Client - File Handle Implementation
 */

import { PassThrough, Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { CasFileHandle, CasRawFileNode } from "./types.ts";

export class CasFileHandleImpl implements CasFileHandle {
  private getChunkStreamFn: (key: string) => Promise<Readable>;

  constructor(
    private node: CasRawFileNode,
    getChunkStream: (key: string) => Promise<Readable>
  ) {
    this.getChunkStreamFn = getChunkStream;
  }

  get key(): string {
    return this.node.key;
  }

  get size(): number {
    return this.node.size;
  }

  get contentType(): string {
    return this.node.contentType;
  }

  /**
   * Stream the entire file content by concatenating all chunks
   */
  async stream(): Promise<Readable> {
    const { chunks } = this.node;

    if (chunks.length === 0) {
      // Empty file
      return Readable.from([]);
    }

    if (chunks.length === 1) {
      // Single chunk, return directly
      return this.getChunkStreamFn(chunks[0]!);
    }

    // Multiple chunks: concatenate streams
    const passThrough = new PassThrough();

    // Async IIFE to pipe chunks sequentially
    (async () => {
      try {
        for (const chunkKey of chunks) {
          const chunkStream = await this.getChunkStreamFn(chunkKey);
          await pipeline(chunkStream, passThrough, { end: false });
        }
        passThrough.end();
      } catch (err) {
        passThrough.destroy(err as Error);
      }
    })();

    return passThrough;
  }

  /**
   * Read entire content to buffer (convenience for small files)
   */
  async buffer(): Promise<Buffer> {
    const stream = await this.stream();
    const chunks: Buffer[] = [];

    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  }

  /**
   * Read a range of bytes
   * Note: This is a simplified implementation that reads all chunks
   * and slices the result. A more efficient implementation would
   * track chunk offsets and only read necessary chunks.
   */
  async slice(start: number, end: number): Promise<Readable> {
    // For now, read everything and slice
    // TODO: Optimize by tracking chunk offsets
    const fullContent = await this.buffer();
    const sliced = fullContent.subarray(start, end);
    return Readable.from([sliced]);
  }
}
