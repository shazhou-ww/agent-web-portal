/**
 * Service info controller
 *
 * Provides public service information for clients and tools.
 * NOTE: This endpoint should NOT expose sensitive deployment details.
 */

import type { Context } from "hono";
import type { FeaturesConfig, ServerConfig } from "../config.ts";

// ============================================================================
// Types
// ============================================================================

export type ServiceInfo = {
  /** Service name */
  service: string;
  /** Service version */
  version: string;
  /** Storage backend type */
  storage: "memory" | "fs" | "s3";
  /** Authentication method */
  auth: "mock" | "cognito" | "tokens-only";
  /** Database type */
  database: "local" | "aws";
  /** Server limits */
  limits: {
    /** Maximum node/block size in bytes */
    maxNodeSize: number;
    /** Maximum name length in bytes */
    maxNameBytes: number;
    /** Maximum children in a collection */
    maxCollectionChildren: number;
    /** Maximum payload size for uploads in bytes */
    maxPayloadSize: number;
    /** Maximum ticket TTL in seconds */
    maxTicketTtl: number;
    /** Maximum agent token TTL in seconds */
    maxAgentTokenTtl: number;
  };
  /** Feature flags (controlled via environment variables) */
  features: {
    /** Whether JWT authentication is enabled (FEATURE_JWT_AUTH) */
    jwtAuth: boolean;
    /** Whether OAuth login is enabled (FEATURE_OAUTH_LOGIN) */
    oauthLogin: boolean;
    /** Whether AWP (Agent Web Portal) auth is enabled (FEATURE_AWP_AUTH) */
    awpAuth: boolean;
  };
};

export type InfoControllerDeps = {
  serverConfig: ServerConfig;
  featuresConfig: FeaturesConfig;
  storageType: "memory" | "fs" | "s3";
  authType: "mock" | "cognito" | "tokens-only";
  databaseType: "local" | "aws";
};

export type InfoController = {
  getInfo: (c: Context) => Response;
};

// ============================================================================
// Version
// ============================================================================

// Read from package.json at build time or use fallback
const SERVICE_VERSION = process.env.npm_package_version ?? "0.1.0";

// ============================================================================
// Controller Factory
// ============================================================================

export const createInfoController = (deps: InfoControllerDeps): InfoController => {
  const { serverConfig, featuresConfig, storageType, authType, databaseType } = deps;

  const info: ServiceInfo = {
    service: "casfa-v2",
    version: SERVICE_VERSION,
    storage: storageType,
    auth: authType,
    database: databaseType,
    limits: {
      maxNodeSize: serverConfig.nodeLimit,
      maxNameBytes: serverConfig.maxNameBytes,
      maxCollectionChildren: serverConfig.maxCollectionChildren,
      maxPayloadSize: serverConfig.maxPayloadSize,
      maxTicketTtl: serverConfig.maxTicketTtl,
      maxAgentTokenTtl: serverConfig.maxAgentTokenTtl,
    },
    features: {
      jwtAuth: featuresConfig.jwtAuth,
      oauthLogin: featuresConfig.oauthLogin,
      awpAuth: featuresConfig.awpAuth,
    },
  };

  return {
    getInfo: (c) => c.json(info),
  };
};
