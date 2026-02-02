/**
 * CASFA v2 - Lambda Handler
 *
 * Uses real implementations for AWS Lambda deployment.
 */

import { handle } from "hono/aws-lambda"
import { createS3Storage } from "@agent-web-portal/cas-storage-s3"
import { loadConfig } from "./config.ts"
import { createApp, createNodeHashProvider } from "./app.ts"

// DB factories
import {
  createTokensDb,
  createOwnershipDb,
  createCommitsDb,
  createDepotsDb,
  createRefCountDb,
  createUsageDb,
  createUserRolesDb,
  createAwpPendingDb,
  createAwpPubkeysDb,
} from "./db/index.ts"

// Auth service
import { createAuthService } from "./services/auth.ts"

// ============================================================================
// Create Dependencies (once for Lambda warm start)
// ============================================================================

const config = loadConfig()

const db = {
  tokensDb: createTokensDb({ tableName: config.db.tokensTable }),
  ownershipDb: createOwnershipDb({ tableName: config.db.casRealmTable }),
  commitsDb: createCommitsDb({ tableName: config.db.casRealmTable }),
  depotsDb: createDepotsDb({ tableName: config.db.casRealmTable }),
  refCountDb: createRefCountDb({ tableName: config.db.refCountTable }),
  usageDb: createUsageDb({ tableName: config.db.usageTable }),
  userRolesDb: createUserRolesDb({ tableName: config.db.tokensTable }),
  awpPendingDb: createAwpPendingDb({ tableName: config.db.tokensTable }),
  awpPubkeysDb: createAwpPubkeysDb({ tableName: config.db.tokensTable }),
}

const storage = createS3Storage({
  bucket: config.storage.bucket,
  prefix: config.storage.prefix,
})

const authService = createAuthService({
  tokensDb: db.tokensDb,
  userRolesDb: db.userRolesDb,
  cognitoConfig: config.cognito,
})

const hashProvider = createNodeHashProvider()

// ============================================================================
// Create App
// ============================================================================

const app = createApp({
  config,
  db,
  storage,
  authService,
  hashProvider,
})

// ============================================================================
// Lambda Handler
// ============================================================================

export const handler = handle(app)
