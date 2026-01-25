/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck - SST types are generated on first run (npx sst dev)
/// <reference path="./.sst/platform/config.d.ts" />

/**
 * SST Ion (v3) Configuration for AWP Examples
 *
 * This is a pure SST implementation for Agent Web Portal examples.
 * No SAM templates required.
 *
 * NOTE: TypeScript errors in this file are expected before running SST.
 * The type definitions are auto-generated when you run `npx sst dev` or `npx sst deploy`.
 *
 * Deploys:
 * - API Gateway v2 for MCP portal endpoints
 * - Lambda function for request handling
 * - DynamoDB table for auth state storage
 * - S3 bucket for blob storage (images)
 * - S3 bucket for skills storage (optional)
 * - Static site for React UI (S3 + CloudFront)
 *
 * Usage:
 *   # Development (with live reload)
 *   npx sst dev
 *
 *   # Deploy to AWS
 *   npx sst deploy
 *
 *   # Deploy to production
 *   npx sst deploy --stage production
 *
 *   # Remove all resources
 *   npx sst remove
 */

export default $config({
  app(input) {
    return {
      name: "awp-examples-sst",
      removal: input?.stage === "production" ? "retain" : "remove",
      protect: input?.stage === "production",
      home: "aws",
      providers: {
        aws: {
          region: "us-east-1",
        },
      },
    };
  },

  async run() {
    // =========================================================================
    // DynamoDB Table for Auth
    // =========================================================================
    // Stores:
    // - Pending auth requests (pk: "pending:{verificationCode}")
    // - Authorized public keys (pk: "pubkey:{pubkeyHash}")
    const authTable = new sst.aws.Dynamo("AuthTable", {
      fields: {
        pk: "string",
      },
      primaryIndex: { hashKey: "pk" },
      ttl: "ttl",
    });

    // =========================================================================
    // S3 Bucket for Blob Storage
    // =========================================================================
    // Used for:
    // - Temporary uploads (temp/{id}) - 5 min TTL
    // - Output blobs (output/{id}) - 5 min TTL
    // - Permanent images (images/{date}/{id}) - 1 day TTL
    const blobBucket = new sst.aws.Bucket("BlobBucket", {
      cors: {
        allowHeaders: ["*"],
        allowMethods: ["GET", "PUT", "HEAD"],
        allowOrigins: ["*"],
        maxAge: "1 hour",
      },
    });

    // =========================================================================
    // S3 Bucket for Skills (Optional)
    // =========================================================================
    // Stores skill definitions (SKILL.md files)
    const skillsBucket = new sst.aws.Bucket("SkillsBucket");

    // =========================================================================
    // API Gateway v2 (HTTP API)
    // =========================================================================
    const api = new sst.aws.ApiGatewayV2("Api", {
      cors: {
        allowHeaders: [
          "Content-Type",
          "Authorization",
          "Mcp-Session-Id",
          "X-AWP-Signature",
          "X-AWP-Pubkey",
          "X-AWP-Timestamp",
        ],
        allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowOrigins: ["*"],
      },
    });

    // =========================================================================
    // Lambda Function (Default Route Handler)
    // =========================================================================
    // Single Lambda handles all portal routes:
    // - /basic/*     -> Basic greeting portal
    // - /ecommerce/* -> E-commerce portal
    // - /jsonata/*   -> JSONata portal
    // - /auth/*      -> Auth-enabled portal
    // - /blob/*      -> Blob portal
    // - /ui/*        -> Static UI assets
    api.route("$default", {
      handler: "src/handler.handler",
      link: [authTable, blobBucket, skillsBucket],
      environment: {
        AUTH_TABLE: authTable.name,
        BLOB_BUCKET: blobBucket.name,
        SKILLS_BUCKET: skillsBucket.name,
        NODE_OPTIONS: "--enable-source-maps",
      },
      timeout: "30 seconds",
      memory: "512 MB",
      nodejs: {
        install: ["jsonata"],
      },
    });

    // =========================================================================
    // Static Site for React UI (S3 + CloudFront)
    // =========================================================================
    const site = new sst.aws.StaticSite("UI", {
      path: "ui",
      build: {
        command: "npm run build",
        output: "dist",
      },
      environment: {
        VITE_API_URL: api.url,
      },
    });

    // =========================================================================
    // Outputs
    // =========================================================================
    return {
      // API Endpoints
      api: api.url,
      ui: site.url,

      // Resource Names
      authTable: authTable.name,
      blobBucket: blobBucket.name,
      skillsBucket: skillsBucket.name,
    };
  },
});
