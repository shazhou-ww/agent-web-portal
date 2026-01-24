/**
 * Mock Storage Provider for E2E Testing
 *
 * A simple in-memory mock implementation of StorageProvider
 * that generates predictable presigned URLs for testing.
 */

import type { PresignedUrlPair, StorageProvider } from "@agent-web-portal/client";

/**
 * Call record for tracking storage operations in tests
 */
export interface StorageCall {
  method: "GET" | "PUT";
  uri: string;
  prefix?: string;
  timestamp: number;
}

/**
 * Mock Storage Provider
 *
 * Generates predictable presigned URLs for testing blob handling.
 * All URLs point to a mock storage endpoint.
 */
export class MockStorageProvider implements StorageProvider {
  private calls: StorageCall[] = [];
  private callCounter = 0;
  private baseUrl: string;

  constructor(baseUrl = "https://mock.storage.test") {
    this.baseUrl = baseUrl;
  }

  /**
   * Generate a presigned GET URL for reading a blob
   */
  async generatePresignedGetUrl(uri: string, _options?: unknown): Promise<string> {
    this.calls.push({
      method: "GET",
      uri,
      timestamp: Date.now(),
    });

    return `${this.baseUrl}/get?uri=${encodeURIComponent(uri)}&sig=mock-signature`;
  }

  /**
   * Generate a presigned PUT URL for writing a blob
   */
  async generatePresignedPutUrl(prefix: string, _options?: unknown): Promise<PresignedUrlPair> {
    this.callCounter++;
    const key = `${prefix}/${this.callCounter}`;
    const uri = `mock://${key}`;

    this.calls.push({
      method: "PUT",
      uri,
      prefix,
      timestamp: Date.now(),
    });

    return {
      uri,
      presignedUrl: `${this.baseUrl}/put?key=${encodeURIComponent(key)}&sig=mock-signature`,
    };
  }

  /**
   * Check if this provider can handle the given URI
   */
  canHandle(uri: string): boolean {
    return uri.startsWith("mock://");
  }

  /**
   * Get all recorded calls (for test assertions)
   */
  getCalls(): StorageCall[] {
    return [...this.calls];
  }

  /**
   * Clear all recorded calls
   */
  clearCalls(): void {
    this.calls = [];
    this.callCounter = 0;
  }

  /**
   * Get the number of GET calls made
   */
  getGetCallCount(): number {
    return this.calls.filter((c) => c.method === "GET").length;
  }

  /**
   * Get the number of PUT calls made
   */
  getPutCallCount(): number {
    return this.calls.filter((c) => c.method === "PUT").length;
  }
}
