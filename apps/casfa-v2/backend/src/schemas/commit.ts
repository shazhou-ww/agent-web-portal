/**
 * Commit-related Zod schemas
 */

import { z } from "zod";

const CAS_KEY_REGEX = /^sha256:[a-f0-9]{64}$/;

export const CommitSchema = z.object({
  root: z.string().regex(CAS_KEY_REGEX, "Invalid root key format"),
  title: z.string().max(500).optional(),
});

export const UpdateCommitSchema = z.object({
  title: z.string().optional(),
});
