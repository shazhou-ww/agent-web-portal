/**
 * CAS Client - Chunking Utilities
 */

import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * Compute SHA-256 hash of content and return as CAS key
 */
export function computeKey(content: Buffer): string {
  const hash = createHash("sha256").update(content).digest("hex");
  return `sha256:${hash}`;
}

/**
 * Split content into chunks based on threshold
 */
export function splitIntoChunks(content: Buffer, threshold: number): Buffer[] {
  if (content.length <= threshold) {
    return [content];
  }

  const chunks: Buffer[] = [];
  let offset = 0;

  while (offset < content.length) {
    const end = Math.min(offset + threshold, content.length);
    chunks.push(content.subarray(offset, end));
    offset = end;
  }

  return chunks;
}

/**
 * Compute key for each chunk
 */
export function computeChunkKeys(chunks: Buffer[]): string[] {
  return chunks.map((chunk) => computeKey(chunk));
}

/**
 * Read a stream into a buffer
 */
export async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Check if content needs chunking
 */
export function needsChunking(size: number, threshold: number): boolean {
  return size > threshold;
}
