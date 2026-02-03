/**
 * CASFA v2 - Configuration
 *
 * All configuration loading functions.
 */

// ============================================================================
// Server Config
// ============================================================================

export type ServerConfig = {
  nodeLimit: number;
  maxNameBytes: number;
  maxCollectionChildren: number;
  maxPayloadSize: number;
  maxTicketTtl: number;
  maxAgentTokenTtl: number;
  baseUrl: string;
};

export const loadServerConfig = (): ServerConfig => ({
  nodeLimit: Number.parseInt(process.env.CAS_NODE_LIMIT ?? "4194304", 10),
  maxNameBytes: Number.parseInt(process.env.CAS_MAX_NAME_BYTES ?? "255", 10),
  maxCollectionChildren: Number.parseInt(process.env.CAS_MAX_COLLECTION_CHILDREN ?? "10000", 10),
  maxPayloadSize: Number.parseInt(process.env.CAS_MAX_PAYLOAD_SIZE ?? "10485760", 10),
  maxTicketTtl: Number.parseInt(process.env.CAS_MAX_TICKET_TTL ?? "86400", 10),
  maxAgentTokenTtl: Number.parseInt(process.env.CAS_MAX_AGENT_TOKEN_TTL ?? "2592000", 10),
  baseUrl: process.env.CAS_BASE_URL ?? "http://localhost:3560",
});

// ============================================================================
// Database Config
// ============================================================================

export type DbConfig = {
  tokensTable: string;
  casRealmTable: string;
  casDagTable: string;
  refCountTable: string;
  usageTable: string;
  dynamoEndpoint?: string;
};

export const loadDbConfig = (): DbConfig => ({
  tokensTable: process.env.TOKENS_TABLE ?? "cas-tokens",
  casRealmTable: process.env.CAS_REALM_TABLE ?? "cas-realm",
  casDagTable: process.env.CAS_DAG_TABLE ?? "cas-dag",
  refCountTable: process.env.CAS_REFCOUNT_TABLE ?? "cas-refcount",
  usageTable: process.env.CAS_USAGE_TABLE ?? "cas-usage",
  dynamoEndpoint: process.env.DYNAMODB_ENDPOINT,
});

// ============================================================================
// Storage Config
// ============================================================================

export type StorageConfig = {
  bucket: string;
  prefix: string;
};

export const loadStorageConfig = (): StorageConfig => ({
  bucket: process.env.CAS_BUCKET ?? "cas-bucket",
  prefix: process.env.CAS_PREFIX ?? "cas/sha256/",
});

// ============================================================================
// Cognito Config
// ============================================================================

export type CognitoConfig = {
  userPoolId: string;
  clientId: string;
  region: string;
  hostedUiUrl: string;
};

export const loadCognitoConfig = (): CognitoConfig => ({
  userPoolId: process.env.COGNITO_USER_POOL_ID ?? "",
  clientId: process.env.CASFA_COGNITO_CLIENT_ID ?? process.env.COGNITO_CLIENT_ID ?? "",
  region: process.env.COGNITO_REGION ?? "us-east-1",
  hostedUiUrl: process.env.COGNITO_HOSTED_UI_URL ?? "",
});

// ============================================================================
// App Config (combined)
// ============================================================================

export type AppConfig = {
  server: ServerConfig;
  db: DbConfig;
  storage: StorageConfig;
  cognito: CognitoConfig;
};

export const loadConfig = (): AppConfig => ({
  server: loadServerConfig(),
  db: loadDbConfig(),
  storage: loadStorageConfig(),
  cognito: loadCognitoConfig(),
});
