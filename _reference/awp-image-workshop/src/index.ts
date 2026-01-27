/**
 * AWP Image Workshop Lambda Handler
 *
 * AWS Lambda entry point with HMAC authentication
 */

import { createLambdaHandler } from '@agent-web-portal/aws-lambda';
import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2, Context } from 'aws-lambda';
import { PUBLIC_PATHS, verifyHmacAuth } from './middleware/hmac-auth.js';
import { portal } from './portal.js';

/**
 * Create the base AWP Lambda handler
 */
const awpHandler = createLambdaHandler(portal);

/**
 * Convert APIGatewayProxyEventV2 to Request object for HMAC verification
 */
function eventToRequest(event: APIGatewayProxyEventV2): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(event.headers || {})) {
    if (value) headers.set(key, value);
  }

  const protocol = headers.get('x-forwarded-proto') || 'https';
  const host = headers.get('host') || 'localhost';
  const path = event.rawPath || '/';
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  const url = `${protocol}://${host}${path}${query}`;

  const method = event.requestContext?.http?.method || 'GET';
  const body = event.body
    ? event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString()
      : event.body
    : undefined;

  return new Request(url, {
    method,
    headers,
    body: method !== 'GET' && method !== 'HEAD' ? body : undefined,
  });
}

/**
 * Lambda handler with HMAC authentication wrapper
 */
export async function handler(
  event: APIGatewayProxyEventV2,
  context: Context
): Promise<APIGatewayProxyResultV2> {
  const path = event.rawPath || '/';

  // Skip auth for public paths
  if (!PUBLIC_PATHS.includes(path)) {
    const request = eventToRequest(event);
    const authResult = await verifyHmacAuth(request);

    if (!authResult.authorized) {
      return {
        statusCode: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'HMAC',
        },
        body: JSON.stringify({
          error: 'unauthorized',
          error_description: authResult.error || 'Authentication required',
        }),
      };
    }
  }

  // Delegate to AWP handler
  // @ts-expect-error - createLambdaHandler expects APIGatewayProxyEvent but we use V2
  return awpHandler(event, context) as Promise<APIGatewayProxyResultV2>;
}

interface SkillInfo {
  name: string;
  description: string;
}

interface ToolInfo {
  name: string;
  description: string;
}

/**
 * Health check handler (for ALB/NLB health checks)
 */
export async function healthHandler(): Promise<APIGatewayProxyResultV2> {
  const skills = portal.listSkills() as unknown as SkillInfo[];
  const tools = portal.listTools() as unknown as ToolInfo[];

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status: 'healthy',
      portal: 'awp-image-workshop',
      skills: skills.map((s) => s.name),
      toolCount: tools.length,
    }),
  };
}
