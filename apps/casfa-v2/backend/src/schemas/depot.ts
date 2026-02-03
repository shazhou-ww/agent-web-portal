/**
 * Depot-related Zod schemas
 */

import { z } from "zod";

const CAS_KEY_REGEX = /^sha256:[a-f0-9]{64}$/;

export const CreateDepotSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const UpdateDepotSchema = z.object({
  root: z.string().regex(CAS_KEY_REGEX, "Invalid root key format"),
  message: z.string().max(500).optional(),
});

export const RollbackDepotSchema = z.object({
  version: z.number().int().positive(),
});
