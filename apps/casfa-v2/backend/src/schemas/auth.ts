/**
 * Auth-related Zod schemas
 */

import { z } from "zod";

export const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});

export const TokenExchangeSchema = z.object({
  code: z.string().min(1),
  redirect_uri: z.string().url(),
});

export const AwpAuthInitSchema = z.object({
  pubkey: z.string().min(1),
  client_name: z.string().min(1),
});

export const AwpAuthCompleteSchema = z.object({
  pubkey: z.string().min(1),
  verification_code: z.string().min(1),
});

export const CreateTicketSchema = z.object({
  scope: z.array(z.string()).optional(),
  commit: z
    .object({
      quota: z.number().positive().optional(),
      accept: z.array(z.string()).optional(),
    })
    .optional(),
  expiresIn: z.number().positive().optional(),
});

export const CreateAgentTokenSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  expiresIn: z.number().positive().optional(),
});
