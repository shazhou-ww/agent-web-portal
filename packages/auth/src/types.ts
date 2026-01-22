/**
 * Authentication Types for Agent Web Portal
 *
 * Supports multiple authentication schemes:
 * - OAuth 2.1 (RFC 9728 Protected Resource Metadata)
 * - HMAC signature (for microservice communication)
 * - API Key (simple static key authentication)
 */

// ============================================================================
// Auth Scheme Types
// ============================================================================

export type AuthSchemeType = "oauth2" | "hmac" | "api_key";

/**
 * Base auth scheme configuration
 */
export interface AuthSchemeBase {
  type: AuthSchemeType;
  /** Optional realm for WWW-Authenticate header (default: "mcp") */
  realm?: string;
}

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728)
 */
export interface ProtectedResourceMetadata {
  /** URI identifying the protected resource */
  resource: string;
  /** List of authorization server URLs */
  authorization_servers: string[];
  /** Supported OAuth scopes */
  scopes_supported?: string[];
  /** Supported bearer token presentation methods */
  bearer_methods_supported?: ("header" | "body" | "query")[];
  /** Documentation URL for the resource */
  resource_documentation?: string;
  /** Human-readable name of the resource */
  resource_name?: string;
  /** Human-readable description of the resource */
  resource_description?: string;
}

/**
 * Token validation result
 */
export interface TokenValidationResult {
  /** Whether the token is valid */
  valid: boolean;
  /** Decoded token claims if valid */
  claims?: Record<string, unknown>;
  /** Error message if invalid */
  error?: string;
}

/**
 * OAuth 2.1 scheme configuration
 */
export interface OAuthScheme extends AuthSchemeBase {
  type: "oauth2";
  /** Protected Resource Metadata (RFC 9728) */
  resourceMetadata: ProtectedResourceMetadata;
  /** Token validation handler */
  validateToken: (token: string) => Promise<TokenValidationResult>;
}

/**
 * HMAC signature scheme configuration
 *
 * Used for secure microservice-to-microservice communication
 * with shared secret keys.
 */
export interface HMACScheme extends AuthSchemeBase {
  type: "hmac";
  /**
   * Shared secret key, or a function to retrieve the secret by key ID.
   * Use a function when you have multiple service keys.
   */
  secret: string | ((keyId: string) => Promise<string | null>);
  /** Hash algorithm (default: "sha256") */
  algorithm?: "sha256" | "sha384" | "sha512";
  /** Header name for signature (default: "X-AWP-Signature") */
  signatureHeader?: string;
  /** Header name for key ID (default: "X-AWP-Key-Id") */
  keyIdHeader?: string;
  /** Header name for timestamp (default: "X-AWP-Timestamp") */
  timestampHeader?: string;
  /** Maximum allowed clock skew in seconds (default: 300) */
  maxClockSkew?: number;
}

/**
 * API Key validation result
 */
export interface KeyValidationResult {
  /** Whether the key is valid */
  valid: boolean;
  /** Associated metadata (e.g., user ID, permissions, tier) */
  metadata?: Record<string, unknown>;
  /** Error message if invalid */
  error?: string;
}

/**
 * API Key scheme configuration
 */
export interface APIKeyScheme extends AuthSchemeBase {
  type: "api_key";
  /** Header name for the API key (default: "X-API-Key") */
  header?: string;
  /** Key validation handler */
  validateKey: (key: string) => Promise<KeyValidationResult>;
}

/**
 * Union type of all supported auth schemes
 */
export type AuthScheme = OAuthScheme | HMACScheme | APIKeyScheme;

// ============================================================================
// Auth Configuration
// ============================================================================

/**
 * Authentication configuration
 */
export interface AuthConfig {
  /**
   * Supported auth schemes.
   * Order matters - it determines the order in the 401 challenge response.
   */
  schemes: AuthScheme[];
  /**
   * Paths to exclude from authentication.
   * Well-known endpoints are automatically excluded.
   */
  excludePaths?: string[];
}

// ============================================================================
// Auth Context
// ============================================================================

/**
 * Authentication context attached to request after successful authentication.
 * Can be used by downstream handlers to access auth information.
 */
export interface AuthContext {
  /** The scheme that was used for authentication */
  scheme: AuthSchemeType;
  /** For OAuth: decoded token claims */
  claims?: Record<string, unknown>;
  /** For API Key: key metadata */
  metadata?: Record<string, unknown>;
  /** For HMAC: the key ID used for signing */
  keyId?: string;
}

// ============================================================================
// Auth Result
// ============================================================================

/**
 * Result of authentication check
 */
export interface AuthResult {
  /** Whether the request is authorized */
  authorized: boolean;
  /** Auth context if authorized */
  context?: AuthContext;
  /** Challenge response to return if not authorized (401) */
  challengeResponse?: Response;
}

// ============================================================================
// HTTP Types (compatible with various runtimes)
// ============================================================================

/**
 * HTTP Request interface (compatible with Fetch API, Bun, etc.)
 */
export interface AuthHttpRequest {
  method: string;
  url: string;
  headers: Headers | Record<string, string>;
  text(): Promise<string>;
  clone(): AuthHttpRequest;
}

// ============================================================================
// Scheme Info for Challenge Response
// ============================================================================

/**
 * OAuth scheme info in challenge response
 */
export interface OAuthSchemeInfo {
  scheme: "oauth2";
  resource_metadata_url: string;
}

/**
 * HMAC scheme info in challenge response
 */
export interface HMACSchemeInfo {
  scheme: "hmac";
  algorithm: string;
  signature_header: string;
  key_id_header: string;
  timestamp_header: string;
}

/**
 * API Key scheme info in challenge response
 */
export interface APIKeySchemeInfo {
  scheme: "api_key";
  header: string;
}

/**
 * Union type of scheme info for challenge response
 */
export type SchemeInfo = OAuthSchemeInfo | HMACSchemeInfo | APIKeySchemeInfo;

/**
 * 401 Challenge response body
 */
export interface ChallengeBody {
  error: "unauthorized";
  error_description: string;
  supported_schemes: SchemeInfo[];
}
