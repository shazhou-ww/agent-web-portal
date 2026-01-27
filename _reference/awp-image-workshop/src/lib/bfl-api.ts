/**
 * Black Forest Labs (BFL) FLUX API Client
 *
 * Supports async polling for result retrieval
 */

// ============================================================================
// Constants & Types
// ============================================================================

export const BFL_API_HOST = 'https://api.bfl.ml';

const POLL_INTERVAL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export const BFL_ENDPOINTS = {
  FLUX_PRO_1_1: '/v1/flux-pro-1.1',
  FLUX_DEV: '/v1/flux-dev',
  FLUX_KONTEXT_PRO: '/v1/flux-kontext-pro',
  FLUX_KONTEXT_MAX: '/v1/flux-kontext-max',
  FLUX_FILL: '/v1/flux-pro-1.1-fill',
  FLUX_EXPAND: '/v1/flux-pro-1.1-canny-expand',
  GET_RESULT: '/v1/get_result',
} as const;

export type BflEndpoint = (typeof BFL_ENDPOINTS)[keyof typeof BFL_ENDPOINTS] | string;

export type BflTaskStatus =
  | 'Pending'
  | 'Ready'
  | 'Error'
  | 'Request Moderated'
  | 'Content Moderated';

export interface BflResultResponse {
  id: string;
  status: BflTaskStatus;
  result?: {
    sample?: string;
    seed?: number;
  };
}

export interface BflImageResponse {
  id: string;
  imageUrl: string;
  seed?: number;
}

// ============================================================================
// API Functions
// ============================================================================

export async function submitBflTask(
  endpoint: BflEndpoint,
  apiKey: string,
  body: Record<string, unknown>
): Promise<string> {
  const response = await fetch(`${BFL_API_HOST}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BFL API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function getTaskResult(taskId: string, apiKey: string): Promise<BflResultResponse> {
  const response = await fetch(`${BFL_API_HOST}${BFL_ENDPOINTS.GET_RESULT}?id=${taskId}`, {
    method: 'GET',
    headers: { 'x-key': apiKey },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`BFL get_result error: ${response.status} - ${errorText}`);
  }

  return (await response.json()) as BflResultResponse;
}

export async function waitForResult(
  taskId: string,
  apiKey: string,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<BflResultResponse> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const result = await getTaskResult(taskId, apiKey);

    if (result.status === 'Ready') {
      return result;
    }

    if (result.status === 'Error') {
      throw new Error('BFL task failed with error');
    }

    if (result.status === 'Request Moderated' || result.status === 'Content Moderated') {
      throw new Error(`BFL content moderated: ${result.status}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error('BFL task timeout');
}

export async function callBflApi(
  endpoint: BflEndpoint,
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<BflImageResponse> {
  const taskId = await submitBflTask(endpoint, apiKey, body);
  const result = await waitForResult(taskId, apiKey, timeoutMs);

  if (!result.result?.sample) {
    throw new Error('No image URL in BFL result');
  }

  return {
    id: taskId,
    imageUrl: result.result.sample,
    seed: result.result.seed,
  };
}

export async function urlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
}

export function getContentType(format: string): string {
  switch (format) {
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'image/png';
  }
}
