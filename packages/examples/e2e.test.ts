/**
 * E2E Test Suite for Agent Web Portal
 *
 * Run tests with:
 *   bun test examples/e2e.test.ts
 *
 * The server is started using SAM local start-api.
 * Prerequisites:
 *   - AWS SAM CLI installed
 *   - Docker running
 *   - bun run build (to build the Lambda handler)
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";

const PORT = 3456;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: Subprocess;

// Start SAM local as background process before tests
beforeAll(async () => {
  // Check if we should use SAM local or Bun server
  const useSamLocal = process.env.USE_SAM_LOCAL === "true";

  if (useSamLocal) {
    // Start SAM local start-api
    const serverDir = import.meta.dir;
    serverProcess = Bun.spawn(
      ["sam", "local", "start-api", "--port", String(PORT), "--warm-containers", "EAGER"],
      {
        cwd: serverDir,
        env: { ...process.env },
        stdout: "inherit",
        stderr: "inherit",
      }
    );

    // SAM local takes longer to start
    const maxRetries = 60;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${BASE_URL}/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    throw new Error("SAM local failed to start within timeout");
  } else {
    // Use Bun server for faster local testing
    const serverDir = import.meta.dir;
    serverProcess = Bun.spawn(["bun", "run", "server.ts"], {
      cwd: serverDir,
      env: { ...process.env, PORT: String(PORT) },
      stdout: "inherit",
      stderr: "inherit",
    });

    // Wait for server to be ready
    const maxRetries = 30;
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(`${BASE_URL}/health`);
        if (response.ok) {
          return;
        }
      } catch {
        // Server not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error("Server failed to start within timeout");
  }
});

afterAll(() => {
  serverProcess?.kill();
});

// Response type for JSON-RPC
interface JsonRpcResult {
  jsonrpc: string;
  id: number;
  result?: any;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

// Helper to make JSON-RPC requests
async function jsonRpc(
  path: string,
  method: string,
  params?: Record<string, unknown>,
  id = 1
): Promise<JsonRpcResult> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params,
    }),
  });

  return response.json() as Promise<JsonRpcResult>;
}

// =============================================================================
// Server Health Tests
// =============================================================================

describe("Server Health", () => {
  test("health endpoint returns ok", async () => {
    const response = await fetch(`${BASE_URL}/health`);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(result).toHaveProperty("status", "ok");
  });

  test("api endpoint returns portal list", async () => {
    const response = await fetch(`${BASE_URL}/api`);
    const result = (await response.json()) as any;

    expect(response.status).toBe(200);
    expect(result.portals).toBeDefined();
    expect(result.portals.basic).toBeDefined();
    expect(result.portals.ecommerce).toBeDefined();
    expect(result.portals.jsonata).toBeDefined();
    expect(result.portals.auth).toBeDefined();
    expect(result.portals.blob).toBeDefined();
  });

  test("unknown route returns 404", async () => {
    const response = await fetch(`${BASE_URL}/unknown/path`);
    expect(response.status).toBe(404);
  });
});

// =============================================================================
// Basic Portal Tests (/basic)
// =============================================================================

describe("Basic Portal (/basic)", () => {
  test("initialize returns server info", async () => {
    const result = await jsonRpc("/basic", "initialize", {
      protocolVersion: "2025-01-01",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(result.result).toBeDefined();
    expect(result.result.serverInfo.name).toBe("greeting-portal");
    expect(result.result.protocolVersion).toBeDefined();
  });

  test("tools/list returns registered tools", async () => {
    const result = await jsonRpc("/basic", "tools/list");

    expect(result.result).toBeDefined();
    expect(result.result.tools).toBeArray();
    expect(result.result.tools.length).toBeGreaterThan(0);

    const greetTool = result.result.tools.find((t: any) => t.name === "greet");
    expect(greetTool).toBeDefined();
    expect(greetTool.description).toContain("greeting");
  });

  test("tools/call invokes greet tool (English)", async () => {
    const result = await jsonRpc("/basic", "tools/call", {
      name: "greet",
      arguments: { name: "World", language: "en" },
    });

    expect(result.result).toBeDefined();
    expect(result.result.content).toBeArray();

    const content = JSON.parse(result.result.content[0].text);
    expect(content.message).toBe("Hello, World!");
    expect(content.timestamp).toBeDefined();
  });

  test("tools/call with Spanish greeting", async () => {
    const result = await jsonRpc("/basic", "tools/call", {
      name: "greet",
      arguments: { name: "Mundo", language: "es" },
    });

    const content = JSON.parse(result.result.content[0].text);
    expect(content.message).toBe("¡Hola, Mundo!");
  });

  test("tools/call with French greeting", async () => {
    const result = await jsonRpc("/basic", "tools/call", {
      name: "greet",
      arguments: { name: "Monde", language: "fr" },
    });

    const content = JSON.parse(result.result.content[0].text);
    expect(content.message).toBe("Bonjour, Monde!");
  });

  test("tools/call with invalid tool returns error", async () => {
    const result = await jsonRpc("/basic", "tools/call", {
      name: "nonexistent_tool",
      arguments: {},
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("not found");
  });

  test("unknown method returns error", async () => {
    const result = await jsonRpc("/basic", "unknown/method");

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(-32601);
  });
});

// =============================================================================
// E-commerce Portal Tests (/ecommerce)
// =============================================================================

describe("E-commerce Portal (/ecommerce)", () => {
  test("initialize returns ecommerce server info", async () => {
    const result = await jsonRpc("/ecommerce", "initialize", {
      protocolVersion: "2025-01-01",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(result.result).toBeDefined();
    expect(result.result.serverInfo.name).toBe("ecommerce-portal");
  });

  test("tools/list returns all ecommerce tools", async () => {
    const result = await jsonRpc("/ecommerce", "tools/list");

    expect(result.result.tools).toBeArray();

    const toolNames = result.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain("search_products");
    expect(toolNames).toContain("manage_cart");
    expect(toolNames).toContain("checkout");
  });

  test("search_products tool works", async () => {
    const result = await jsonRpc("/ecommerce", "tools/call", {
      name: "search_products",
      arguments: { query: "laptop", limit: 5 },
    });

    expect(result.result).toBeDefined();
    const content = JSON.parse(result.result.content[0].text);
    expect(content.results).toBeArray();
    expect(content.total).toBeGreaterThan(0);
  });

  test("manage_cart add and list flow", async () => {
    // Clear cart first
    await jsonRpc("/ecommerce", "tools/call", {
      name: "manage_cart",
      arguments: { action: "clear" },
    });

    // Add item
    const addResult = await jsonRpc("/ecommerce", "tools/call", {
      name: "manage_cart",
      arguments: { action: "add", productId: "test-product-1", quantity: 2 },
    });

    const addContent = JSON.parse(addResult.result.content[0].text);
    expect(addContent.success).toBe(true);
    expect(addContent.items.length).toBe(1);
    expect(addContent.items[0].productId).toBe("test-product-1");
    expect(addContent.items[0].quantity).toBe(2);

    // List cart
    const listResult = await jsonRpc("/ecommerce", "tools/call", {
      name: "manage_cart",
      arguments: { action: "list" },
    });

    const listContent = JSON.parse(listResult.result.content[0].text);
    expect(listContent.items.length).toBe(1);
  });

  test("checkout flow works", async () => {
    // Add item to cart first
    await jsonRpc("/ecommerce", "tools/call", {
      name: "manage_cart",
      arguments: { action: "add", productId: "checkout-test", quantity: 1 },
    });

    // Checkout
    const result = await jsonRpc("/ecommerce", "tools/call", {
      name: "checkout",
      arguments: {
        shippingAddress: "123 Test St",
        paymentMethod: "card",
      },
    });

    const content = JSON.parse(result.result.content[0].text);
    expect(content.orderId).toMatch(/^ORD-/);
    expect(content.status).toBe("confirmed");
    expect(content.estimatedDelivery).toBeDefined();
  });
});

// =============================================================================
// JSONata Portal Tests (/jsonata)
// =============================================================================

describe("JSONata Portal (/jsonata)", () => {
  test("initialize returns jsonata server info", async () => {
    const result = await jsonRpc("/jsonata", "initialize", {
      protocolVersion: "2025-01-01",
      capabilities: {},
      clientInfo: { name: "test-client", version: "1.0.0" },
    });

    expect(result.result).toBeDefined();
    expect(result.result.serverInfo.name).toBe("jsonata-portal");
  });

  test("jsonata_eval evaluates expressions", async () => {
    const result = await jsonRpc("/jsonata", "tools/call", {
      name: "jsonata_eval",
      arguments: {
        expression: "$sum(values)",
        input: { values: [1, 2, 3, 4, 5] },
      },
    });

    expect(result.result).toBeDefined();
    const content = JSON.parse(result.result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.result).toBe(15);
  });

  test("jsonata_eval with bindings", async () => {
    const result = await jsonRpc("/jsonata", "tools/call", {
      name: "jsonata_eval",
      arguments: {
        expression: "$x + $y",
        input: {},
        bindings: { x: 10, y: 20 },
      },
    });

    const content = JSON.parse(result.result.content[0].text);
    expect(content.success).toBe(true);
    expect(content.result).toBe(30);
  });

  test("jsonata_eval handles errors gracefully", async () => {
    const result = await jsonRpc("/jsonata", "tools/call", {
      name: "jsonata_eval",
      arguments: {
        expression: "invalid *** syntax",
        input: {},
      },
    });

    const content = JSON.parse(result.result.content[0].text);
    expect(content.success).toBe(false);
    expect(content.error).toBeDefined();
  });
});

// =============================================================================
// AWP Auth Discovery Tests (/auth)
// =============================================================================

describe("AWP Auth Discovery (/auth)", () => {
  const authPath = "/auth";
  const authInitPath = "/auth/init";
  const authStatusPath = "/auth/status";
  const authLoginPath = "/auth/login";
  const authPagePath = "/auth/page";

  // Test keypair for signing requests
  let testPublicKey: string;
  let testPrivateKey: CryptoKey;

  // Generate test keypair before tests
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
      "sign",
      "verify",
    ]);
    const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    testPublicKey = `${publicJwk.x}.${publicJwk.y}`;
    testPrivateKey = keyPair.privateKey;
  });

  // Helper to sign a payload
  async function signPayload(payload: string): Promise<string> {
    const encoder = new TextEncoder();
    const signature = await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      testPrivateKey,
      encoder.encode(payload)
    );
    const base64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  // Helper to hash body
  async function hashBody(body: string): Promise<string> {
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(body));
    const base64 = btoa(String.fromCharCode(...new Uint8Array(hashBuffer)));
    return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  describe("Auth Init Endpoint", () => {
    test("returns verification code for valid pubkey", async () => {
      const response = await fetch(`${BASE_URL}${authInitPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPublicKey,
          client_name: "E2E Test Client",
        }),
      });

      expect(response.status).toBe(200);

      const result = (await response.json()) as any;
      expect(result.auth_url).toBeDefined();
      expect(result.verification_code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
      expect(result.expires_in).toBe(600);
    });

    test("rejects invalid pubkey format", async () => {
      const response = await fetch(`${BASE_URL}${authInitPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: "invalid-format",
          client_name: "Test Client",
        }),
      });

      expect(response.status).toBe(400);
    });
  });

  describe("Auth Page", () => {
    test("returns login page HTML", async () => {
      const response = await fetch(`${BASE_URL}${authPagePath}`);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/html");

      const html = await response.text();
      expect(html).toContain("Authorize Application");
      expect(html).toContain("test / test123");
    });
  });

  describe("Auth Login Flow", () => {
    test("completes auth with valid credentials and verification code", async () => {
      // Step 1: Init auth
      const initResponse = await fetch(`${BASE_URL}${authInitPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPublicKey,
          client_name: "E2E Test Client",
        }),
      });
      const initResult = (await initResponse.json()) as any;
      const verificationCode = initResult.verification_code;

      // Step 2: Login with test user credentials
      const formData = new URLSearchParams();
      formData.append("username", "test");
      formData.append("password", "test123");
      formData.append("verification_code", verificationCode);
      formData.append("pubkey", testPublicKey);

      const loginResponse = await fetch(`${BASE_URL}${authLoginPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      expect(loginResponse.status).toBe(200);

      const html = await loginResponse.text();
      expect(html).toContain("Authorization Complete");

      // Step 3: Check status
      const statusResponse = await fetch(
        `${BASE_URL}${authStatusPath}?pubkey=${encodeURIComponent(testPublicKey)}`
      );
      const statusResult = (await statusResponse.json()) as any;
      expect(statusResult.authorized).toBe(true);
    });

    test("rejects invalid credentials", async () => {
      const formData = new URLSearchParams();
      formData.append("username", "test");
      formData.append("password", "wrongpassword");
      formData.append("verification_code", "ABC-123");
      formData.append("pubkey", "test.key");

      const response = await fetch(`${BASE_URL}${authLoginPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });
      expect(response.status).toBe(401);

      const html = await response.text();
      expect(html).toContain("Invalid username or password");
    });
  });

  describe("401 Challenge Response", () => {
    test("returns 401 without credentials", async () => {
      const response = await fetch(`${BASE_URL}${authPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });

      expect(response.status).toBe(401);
    });

    test("includes auth_init_endpoint in body", async () => {
      const response = await fetch(`${BASE_URL}${authPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/list",
        }),
      });

      const result = (await response.json()) as any;
      expect(result.error).toBe("unauthorized");
      expect(result.auth_init_endpoint).toBe("/auth/init");
    });
  });

  describe("Authenticated Requests", () => {
    test("succeeds with valid signature", async () => {
      // First complete auth flow via login
      const initResponse = await fetch(`${BASE_URL}${authInitPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pubkey: testPublicKey,
          client_name: "Signed Request Test",
        }),
      });
      const { verification_code } = (await initResponse.json()) as any;

      // Complete auth via login form
      const formData = new URLSearchParams();
      formData.append("username", "test");
      formData.append("password", "test123");
      formData.append("verification_code", verification_code);
      formData.append("pubkey", testPublicKey);

      await fetch(`${BASE_URL}${authLoginPath}`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formData.toString(),
      });

      // Now make signed request
      const body = JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
      });
      const timestamp = Math.floor(Date.now() / 1000).toString();
      const bodyHash = await hashBody(body);
      const payload = `${timestamp}.POST./auth.${bodyHash}`;
      const signature = await signPayload(payload);

      const response = await fetch(`${BASE_URL}${authPath}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-AWP-Pubkey": testPublicKey,
          "X-AWP-Timestamp": timestamp,
          "X-AWP-Signature": signature,
        },
        body,
      });

      expect(response.status).toBe(200);
      const result = (await response.json()) as JsonRpcResult;
      expect(result.result).toBeDefined();
      expect(result.result.tools).toBeArray();
    });
  });
});

// =============================================================================
// Error Handling Tests
// =============================================================================

describe("Error Handling", () => {
  test("invalid JSON returns parse error", async () => {
    const response = await fetch(`${BASE_URL}/basic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ invalid json }",
    });

    const result = (await response.json()) as JsonRpcResult;
    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(-32700);
  });

  test("GET request returns method not allowed", async () => {
    const response = await fetch(`${BASE_URL}/basic`);
    expect(response.status).toBe(405);
  });
});

// =============================================================================
// Portal Isolation Tests
// =============================================================================

describe("Portal Isolation", () => {
  test("basic portal cannot access ecommerce tools", async () => {
    const result = await jsonRpc("/basic", "tools/call", {
      name: "search_products",
      arguments: { query: "test" },
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("not found");
  });

  test("ecommerce portal cannot access basic tools", async () => {
    const result = await jsonRpc("/ecommerce", "tools/call", {
      name: "greet",
      arguments: { name: "Test" },
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain("not found");
  });
});
