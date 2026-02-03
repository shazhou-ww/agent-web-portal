/**
 * Admin-related Zod schemas
 */

import { z } from "zod";

export const AuthorizeUserSchema = z.object({
  role: z.enum(["authorized", "admin"]),
});
