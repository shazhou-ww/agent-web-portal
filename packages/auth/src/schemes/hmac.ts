/**
 * HMAC Signature Authentication Scheme
 *
 * Implements HMAC-based authentication for secure microservice-to-microservice
 * communication with shared secret keys.
 *
 * Signature format:
 *   signature = HMAC-SHA256(secret, stringToSign)
 *   stringToSign = METHOD + "\n" + PATH + "\n" + TIMESTAMP + "\n" + BODY_HASH
 *   BODY_HASH = SHA256(request-body)
 */

import type { AuthContext, AuthHttpRequest, HMACScheme, HMACSchemeInfo } from "../types.ts";

/**
 * Default configuration for HMAC scheme
 */
export const HMAC_DEFAULTS = {
  realm: "mcp",
  algorithm: "sha256" as const,
  signatureHeader: "X-AWP-Signature",
  keyIdHeader: "X-AWP-Key-Id",
  timestampHeader: "X-AWP-Timestamp",
  maxClockSkew: 300, // 5 minutes
} as const;

/**
 * Get header value from request (handles both Headers and plain object)
 */
function getHeader(headers: Headers | Record<string, string>, name: string): string | null {
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  // Case-insensitive lookup for plain object
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }
  return null;
}

/**
 * Compute SHA256 hash and return as hex string
 */
async function sha256(data: string): Promise<string> {
  const encoder = new TextEncoder();
  const dataBuffer = encoder.encode(data);
  const hashBuffer = await crypto.subtle.digest("SHA-256", dataBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute HMAC signature
 */
async function computeHmac(
  secret: string,
  data: string,
  algorithm: "sha256" | "sha384" | "sha512"
): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const dataBuffer = encoder.encode(data);

  const algoMap = {
    sha256: "SHA-256",
    sha384: "SHA-384",
    sha512: "SHA-512",
  };

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: algoMap[algorithm] },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataBuffer);
  // Return base64 encoded signature
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

/**
 * Build the string to sign
 */
async function buildStringToSign(
  method: string,
  path: string,
  timestamp: string,
  body: string
): Promise<string> {
  const bodyHash = await sha256(body);
  return `${method}\n${path}\n${timestamp}\n${bodyHash}`;
}

/**
 * Validate request using HMAC scheme
 */
export async function validateHMAC(
  request: AuthHttpRequest,
  scheme: HMACScheme
): Promise<{ valid: true; context: AuthContext } | { valid: false; error?: string }> {
  const signatureHeader = scheme.signatureHeader ?? HMAC_DEFAULTS.signatureHeader;
  const keyIdHeader = scheme.keyIdHeader ?? HMAC_DEFAULTS.keyIdHeader;
  const timestampHeader = scheme.timestampHeader ?? HMAC_DEFAULTS.timestampHeader;
  const maxClockSkew = scheme.maxClockSkew ?? HMAC_DEFAULTS.maxClockSkew;
  const algorithm = scheme.algorithm ?? HMAC_DEFAULTS.algorithm;

  const headers = request.headers;

  // Extract required headers
  const signature = getHeader(headers, signatureHeader);
  const keyId = getHeader(headers, keyIdHeader);
  const timestampStr = getHeader(headers, timestampHeader);

  if (!signature) {
    return { valid: false, error: `Missing ${signatureHeader} header` };
  }

  if (!timestampStr) {
    return { valid: false, error: `Missing ${timestampHeader} header` };
  }

  // Validate timestamp (prevent replay attacks)
  const timestamp = Number.parseInt(timestampStr, 10);
  if (Number.isNaN(timestamp)) {
    return { valid: false, error: "Invalid timestamp format" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > maxClockSkew) {
    return { valid: false, error: "Request timestamp outside allowed window" };
  }

  // Get secret
  let secret: string | null;
  if (typeof scheme.secret === "function") {
    if (!keyId) {
      return { valid: false, error: `Missing ${keyIdHeader} header` };
    }
    secret = await scheme.secret(keyId);
    if (!secret) {
      return { valid: false, error: "Unknown key ID" };
    }
  } else {
    secret = scheme.secret;
  }

  // Clone request to read body
  const clonedRequest = request.clone();
  const body = await clonedRequest.text();

  // Extract path from URL
  const url = new URL(request.url);
  const path = url.pathname;

  // Compute expected signature
  const stringToSign = await buildStringToSign(request.method, path, timestampStr, body);
  const expectedSignature = await computeHmac(secret, stringToSign, algorithm);

  // Constant-time comparison
  if (signature !== expectedSignature) {
    return { valid: false, error: "Invalid signature" };
  }

  return {
    valid: true,
    context: {
      scheme: "hmac",
      keyId: keyId ?? undefined,
    },
  };
}

/**
 * Build WWW-Authenticate header value for HMAC
 */
export function buildHMACWwwAuthenticate(scheme: HMACScheme): string {
  const realm = scheme.realm ?? HMAC_DEFAULTS.realm;
  return `X-AWP-HMAC realm="${realm}"`;
}

/**
 * Build scheme info for challenge response body
 */
export function buildHMACSchemeInfo(scheme: HMACScheme): HMACSchemeInfo {
  return {
    scheme: "hmac",
    algorithm: scheme.algorithm ?? HMAC_DEFAULTS.algorithm,
    signature_header: scheme.signatureHeader ?? HMAC_DEFAULTS.signatureHeader,
    key_id_header: scheme.keyIdHeader ?? HMAC_DEFAULTS.keyIdHeader,
    timestamp_header: scheme.timestampHeader ?? HMAC_DEFAULTS.timestampHeader,
  };
}
