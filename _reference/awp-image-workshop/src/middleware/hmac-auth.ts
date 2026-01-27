/**
 * HMAC Authentication Middleware
 *
 * Simple HMAC-SHA256 signature verification for MCP endpoints
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { getHmacSecret } from '../secrets.js';

/** Maximum allowed clock skew in seconds */
const MAX_CLOCK_SKEW = 300; // 5 minutes

/** Paths that don't require authentication */
export const PUBLIC_PATHS = ['/health', '/'];

export interface HmacAuthResult {
  authorized: boolean;
  error?: string;
}

/**
 * Verify HMAC signature for a request
 */
export async function verifyHmacAuth(req: Request): Promise<HmacAuthResult> {
  const url = new URL(req.url);

  // Skip auth for public paths
  if (PUBLIC_PATHS.includes(url.pathname)) {
    return { authorized: true };
  }

  // Get headers
  const signature = req.headers.get('X-HMAC-Signature');
  const timestamp = req.headers.get('X-HMAC-Timestamp');

  if (!signature || !timestamp) {
    return { authorized: false, error: 'Missing HMAC headers' };
  }

  // Validate timestamp
  const requestTime = Number.parseInt(timestamp, 10);
  const now = Math.floor(Date.now() / 1000);

  if (Math.abs(now - requestTime) > MAX_CLOCK_SKEW) {
    return { authorized: false, error: 'Request timestamp expired' };
  }

  // Get request body
  const body = await req.clone().text();

  // Compute expected signature
  const secret = await getHmacSecret();
  const payload = `${timestamp}.${req.method}.${url.pathname}.${body}`;
  const expectedSignature = createHmac('sha256', secret).update(payload).digest('hex');

  // Constant-time comparison
  try {
    const sigBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedSignature, 'hex');

    if (sigBuffer.length !== expectedBuffer.length) {
      return { authorized: false, error: 'Invalid signature' };
    }

    if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
      return { authorized: false, error: 'Invalid signature' };
    }
  } catch {
    return { authorized: false, error: 'Invalid signature format' };
  }

  return { authorized: true };
}

/**
 * Create 401 response for unauthorized requests
 */
export function createUnauthorizedResponse(error: string): Response {
  return new Response(
    JSON.stringify({
      error: 'unauthorized',
      error_description: error,
    }),
    {
      status: 401,
      headers: {
        'Content-Type': 'application/json',
        'WWW-Authenticate': 'HMAC',
      },
    }
  );
}
