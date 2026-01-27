/**
 * Secrets Manager
 *
 * Centralized module for fetching and caching secrets.
 */

import { getKnownConfig } from './lib/aws-config.js';

// ============================================================================
// Cache Configuration
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<string>>();

// ============================================================================
// Cache Helpers
// ============================================================================

function getCached(key: string): string | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;

  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }

  return entry.value;
}

function setCache(key: string, value: string): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// ============================================================================
// Secrets API
// ============================================================================

export async function getStabilityApiKey(): Promise<string> {
  const cacheKey = 'STABILITY_API_KEY';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const apiKey = await getKnownConfig('STABILITY_API_KEY', { required: true });
  setCache(cacheKey, apiKey);
  return apiKey;
}

export async function getBflApiKey(): Promise<string> {
  const cacheKey = 'BFL_API_KEY';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const apiKey = await getKnownConfig('BFL_API_KEY', { required: true });
  setCache(cacheKey, apiKey);
  return apiKey;
}

export async function getHmacSecret(): Promise<string> {
  const cacheKey = 'IMAGE_WORKSHOP_HMAC_SECRET';
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const secret = await getKnownConfig('IMAGE_WORKSHOP_HMAC_SECRET', { required: true });
  setCache(cacheKey, secret);
  return secret;
}

export function clearSecretsCache(): void {
  cache.clear();
}
