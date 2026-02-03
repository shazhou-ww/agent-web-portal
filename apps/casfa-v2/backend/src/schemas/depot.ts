/**
 * Depot-related legacy schemas
 *
 * Main schemas are now in @agent-web-portal/casfa-protocol.
 * This file only contains deprecated/legacy schemas for backward compatibility.
 */

import { z } from "zod";

// ============================================================================
// Deprecated Schemas (for backward compatibility)
// ============================================================================

/**
 * @deprecated Use DepotCommitSchema from casfa-protocol instead
 */
export const RollbackDepotSchema = z.object({
  version: z.number().int().positive(),
});
