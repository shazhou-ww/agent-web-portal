/**
 * In-memory database implementations for testing
 */

export { createMemoryTokensDb } from "./tokens.ts"
export { createMemoryCommitsDb } from "./commits.ts"
export { createMemoryOwnershipDb } from "./ownership.ts"
export { createMemoryRefCountDb } from "./refcount.ts"
export { createMemoryUsageDb } from "./usage.ts"
export { createMemoryUserRolesDb } from "./user-roles.ts"
export { createMemoryDepotsDb } from "./depots.ts"
export { createMemoryAwpPendingDb } from "./awp-pending.ts"
export { createMemoryAwpPubkeysDb } from "./awp-pubkeys.ts"

// ============================================================================
// All DBs type
// ============================================================================

import type { TokensDb } from "../../db/tokens.ts"
import type { CommitsDb } from "../../db/commits.ts"
import type { OwnershipDb } from "../../db/ownership.ts"
import type { RefCountDb } from "../../db/refcount.ts"
import type { UsageDb } from "../../db/usage.ts"
import type { UserRolesDb } from "../../db/user-roles.ts"
import type { DepotsDb } from "../../db/depots.ts"
import type { AwpPendingDb } from "../../db/awp-pending.ts"
import type { AwpPubkeysDb } from "../../db/awp-pubkeys.ts"

export type AllDbs = {
  tokensDb: TokensDb
  commitsDb: CommitsDb
  ownershipDb: OwnershipDb
  refCountDb: RefCountDb
  usageDb: UsageDb
  userRolesDb: UserRolesDb
  depotsDb: DepotsDb
  awpPendingDb: AwpPendingDb
  awpPubkeysDb: AwpPubkeysDb
}

/**
 * Create all memory databases for testing
 */
export const createAllMemoryDbs = (): AllDbs & { clearAll: () => void } => {
  const tokensDb = createMemoryTokensDb()
  const commitsDb = createMemoryCommitsDb()
  const ownershipDb = createMemoryOwnershipDb()
  const refCountDb = createMemoryRefCountDb()
  const usageDb = createMemoryUsageDb()
  const userRolesDb = createMemoryUserRolesDb()
  const depotsDb = createMemoryDepotsDb()
  const awpPendingDb = createMemoryAwpPendingDb()
  const awpPubkeysDb = createMemoryAwpPubkeysDb()

  const clearAll = () => {
    tokensDb._clear()
    commitsDb._clear()
    ownershipDb._clear()
    refCountDb._clear()
    usageDb._clear()
    userRolesDb._clear()
    depotsDb._clear()
    awpPendingDb._clear()
    awpPubkeysDb._clear()
  }

  return {
    tokensDb,
    commitsDb,
    ownershipDb,
    refCountDb,
    usageDb,
    userRolesDb,
    depotsDb,
    awpPendingDb,
    awpPubkeysDb,
    clearAll,
  }
}

// Re-export factory functions
import { createMemoryTokensDb } from "./tokens.ts"
import { createMemoryCommitsDb } from "./commits.ts"
import { createMemoryOwnershipDb } from "./ownership.ts"
import { createMemoryRefCountDb } from "./refcount.ts"
import { createMemoryUsageDb } from "./usage.ts"
import { createMemoryUserRolesDb } from "./user-roles.ts"
import { createMemoryDepotsDb } from "./depots.ts"
import { createMemoryAwpPendingDb } from "./awp-pending.ts"
import { createMemoryAwpPubkeysDb } from "./awp-pubkeys.ts"
