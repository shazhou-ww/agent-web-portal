/**
 * Tests for CasfaEndpoint
 */

import { describe, expect, it, mock } from "bun:test";
import { createMemoryStorageWithInspection as createMemoryStorage } from "@agent-web-portal/cas-storage-memory";
import { CasfaEndpoint } from "../src/endpoint";
import type { EndpointInfo } from "../src/types";

// Mock fetch for testing
const _mockFetch = mock(() => Promise.resolve(new Response()));

describe("CasfaEndpoint", () => {
  const testEndpointUrl = "https://api.example.com/cas/tkt_test123";
  const testAuth = { type: "ticket" as const, id: "tkt_test123" };

  describe("constructor", () => {
    it("should create endpoint with minimal config", () => {
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
      });

      expect(endpoint.getUrl()).toBe(testEndpointUrl);
    });

    it("should strip trailing slash from URL", () => {
      const endpoint = new CasfaEndpoint({
        url: `${testEndpointUrl}/`,
        auth: testAuth,
      });

      expect(endpoint.getUrl()).toBe(testEndpointUrl);
    });

    it("should accept cache provider", () => {
      const cache = createMemoryStorage();
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
        cache,
      });

      expect(endpoint).toBeDefined();
    });

    it("should accept endpoint info", async () => {
      const info: EndpointInfo = {
        realm: "usr_test",
        nodeLimit: 4194304,
        maxNameBytes: 255,
      };

      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
        info,
      });

      const result = await endpoint.getInfo();
      expect(result).toEqual(info);
    });
  });

  describe("createBlobRef", () => {
    it("should create blob reference with default path", () => {
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
      });

      const ref = endpoint.createBlobRef("sha256:abc123");

      expect(ref["#cas-endpoint"]).toBe(testEndpointUrl);
      expect(ref["cas-node"]).toBe("sha256:abc123");
      expect(ref.path).toBe(".");
    });

    it("should create blob reference with custom path", () => {
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
      });

      const ref = endpoint.createBlobRef("sha256:abc123", "images/photo.png");

      expect(ref["#cas-endpoint"]).toBe(testEndpointUrl);
      expect(ref["cas-node"]).toBe("sha256:abc123");
      expect(ref.path).toBe("images/photo.png");
    });

    it("should create blob reference with custom path key", () => {
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
      });

      const ref = endpoint.createBlobRef("sha256:abc123", "data.json", "file");

      expect(ref.file).toBe("data.json");
      expect(ref.path).toBeUndefined();
    });
  });

  describe("resolvePath", () => {
    it("should return root key for empty path", async () => {
      const cache = createMemoryStorage();
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
        cache,
      });

      const result = await endpoint.resolvePath("sha256:root", "");
      expect(result).toBe("sha256:root");
    });

    it("should return root key for dot path", async () => {
      const cache = createMemoryStorage();
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
        cache,
      });

      const result = await endpoint.resolvePath("sha256:root", ".");
      expect(result).toBe("sha256:root");
    });

    it("should return root key for slash path", async () => {
      const cache = createMemoryStorage();
      const endpoint = new CasfaEndpoint({
        url: testEndpointUrl,
        auth: testAuth,
        cache,
      });

      const result = await endpoint.resolvePath("sha256:root", "/");
      expect(result).toBe("sha256:root");
    });
  });
});

describe("createMemoryStorage", () => {
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  it("should store and retrieve data", async () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    await storage.put("sha256:test", data);

    const result = await storage.get("sha256:test");
    expect(result).toEqual(data);
  });

  it("should return null for missing key", async () => {
    const result = await storage.get("sha256:missing");
    expect(result).toBeNull();
  });

  it("should check existence correctly", async () => {
    const data = new Uint8Array([1, 2, 3]);
    await storage.put("sha256:exists", data);

    expect(await storage.has("sha256:exists")).toBe(true);
    expect(await storage.has("sha256:missing")).toBe(false);
  });

  it("should report size correctly", async () => {
    expect(storage.size()).toBe(0);

    await storage.put("sha256:a", new Uint8Array([1, 2, 3]));
    expect(storage.size()).toBe(1);

    await storage.put("sha256:b", new Uint8Array([4, 5, 6]));
    expect(storage.size()).toBe(2);
  });

  it("should clear all data", async () => {
    await storage.put("sha256:a", new Uint8Array([1]));
    await storage.put("sha256:b", new Uint8Array([2]));

    storage.clear();

    expect(storage.size()).toBe(0);
    expect(await storage.has("sha256:a")).toBe(false);
  });
});
