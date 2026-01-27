/**
 * Stability AI API Client
 * Utilities for interacting with Stability AI v2beta endpoints
 */

export const STABILITY_API_HOST = 'https://api.stability.ai';

/**
 * Response from Stability AI image generation endpoints
 */
export interface StabilityImageResponse {
  /** Base64 encoded image data */
  image: string;
  /** MIME type of the image */
  mimeType: string;
  /** Seed used for generation */
  seed: number;
  /** Finish reason */
  finishReason: 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR';
}

/**
 * Helper to decode base64 image data from URL or raw base64
 * For HTTP URLs, use fetchImageFromUrl instead
 */
export function decodeImageInput(input: string): Buffer {
  // Check if it's a data URL
  if (input.startsWith('data:')) {
    const base64Data = input.split(',')[1];
    return Buffer.from(base64Data, 'base64');
  }
  // Assume it's raw base64
  return Buffer.from(input, 'base64');
}

/**
 * Check if input is an HTTP URL
 */
export function isHttpUrl(input: string): boolean {
  return input.startsWith('http://') || input.startsWith('https://');
}

/**
 * Fetch image from HTTP URL and return as Buffer
 */
export async function fetchImageFromUrl(url: string): Promise<Buffer> {
  console.log(`Fetching image from URL: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Get content type from format
 */
export function getContentType(format: string): string {
  switch (format) {
    case 'jpeg':
    case 'jpg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'image/png';
  }
}

/**
 * Create a FormData-compatible blob from base64 image (sync version)
 */
export function createImageBlob(
  base64Data: string,
  filename: string
): { buffer: Buffer; filename: string } {
  const buffer = decodeImageInput(base64Data);
  return { buffer, filename };
}

/**
 * Create a FormData-compatible blob from base64 image or URL (async version)
 */
export async function createImageBlobAsync(
  input: string,
  filename: string
): Promise<{ buffer: Buffer; filename: string }> {
  let buffer: Buffer;
  if (isHttpUrl(input)) {
    buffer = await fetchImageFromUrl(input);
  } else {
    buffer = decodeImageInput(input);
  }
  return { buffer, filename };
}

/**
 * Build multipart form data manually (for environments without FormData)
 */
export function buildMultipartFormData(
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Buffer; filename: string } | undefined>
): { body: Buffer; contentType: string } {
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  const parts: Buffer[] = [];

  // Add text fields
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
      )
    );
  }

  // Add file fields
  for (const [key, file] of Object.entries(files)) {
    if (!file) continue;
    const { buffer, filename } = file;
    // Detect content type from filename
    const ext = filename.split('.').pop()?.toLowerCase() || 'png';
    const contentType = getContentType(ext);

    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"; filename="${filename}"\r\n` +
          `Content-Type: ${contentType}\r\n\r\n`
      )
    );
    parts.push(buffer);
    parts.push(Buffer.from('\r\n'));
  }

  // End boundary
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Prepare files for API call - resolve URLs to buffers
 */
export async function prepareFiles(
  files: Record<string, string | undefined>,
  filenames: Record<string, string>
): Promise<Record<string, { buffer: Buffer; filename: string } | undefined>> {
  const result: Record<string, { buffer: Buffer; filename: string } | undefined> = {};

  for (const [key, value] of Object.entries(files)) {
    if (value === undefined) {
      result[key] = undefined;
      continue;
    }
    const filename = filenames[key] || `${key}.png`;
    result[key] = await createImageBlobAsync(value, filename);
  }

  return result;
}

/**
 * Call Stability AI v2beta API endpoint
 */
export async function callStabilityApi(
  endpoint: string,
  apiKey: string,
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Buffer; filename: string } | undefined>,
  outputFormat = 'png'
): Promise<StabilityImageResponse> {
  const url = `${STABILITY_API_HOST}${endpoint}`;
  const { body, contentType } = buildMultipartFormData(fields, files);

  console.log(`Calling Stability AI: ${endpoint}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'image/*',
      'Content-Type': contentType,
    },
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Stability API Error: ${response.status} - ${errorText}`);
    throw new Error(`Stability AI API error: ${response.status} - ${errorText}`);
  }

  // v2beta returns raw image data
  const imageBuffer = Buffer.from(await response.arrayBuffer());
  const seed = Number.parseInt(response.headers.get('seed') || '0', 10);
  const finishReason =
    (response.headers.get('finish-reason') as 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR') ||
    'SUCCESS';

  return {
    image: imageBuffer.toString('base64'),
    mimeType: getContentType(outputFormat),
    seed,
    finishReason,
  };
}

/**
 * Call Stability AI v1 API endpoint (JSON body format, used for text-to-image)
 */
export async function callStabilityApiV1(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  outputFormat = 'png'
): Promise<StabilityImageResponse> {
  const url = `${STABILITY_API_HOST}${endpoint}`;

  console.log(`Calling Stability AI v1: ${endpoint}`);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Stability API Error: ${response.status} - ${errorText}`);
    throw new Error(`Stability AI API error: ${response.status} - ${errorText}`);
  }

  const result = (await response.json()) as { artifacts: Array<{ base64: string; seed: number; finishReason: string }> };
  const artifact = result.artifacts?.[0];

  if (!artifact) {
    throw new Error('No image generated');
  }

  return {
    image: artifact.base64,
    mimeType: getContentType(outputFormat),
    seed: artifact.seed || 0,
    finishReason: (artifact.finishReason as 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR') || 'SUCCESS',
  };
}

/**
 * Standard Lambda response type
 */
export interface ToolResponse {
  image: string;
  mime_type: string;
  seed: number;
  finish_reason: 'SUCCESS' | 'CONTENT_FILTERED' | 'ERROR';
}

/**
 * Convert Stability API response to tool response format
 */
export function toToolResponse(response: StabilityImageResponse): ToolResponse {
  return {
    image: response.image,
    mime_type: response.mimeType,
    seed: response.seed,
    finish_reason: response.finishReason,
  };
}
