/**
 * Stability AI API Client
 *
 * Utilities for interacting with Stability AI v1 and v2beta endpoints
 */

// ============================================================================
// Constants & Types
// ============================================================================

export const STABILITY_API_HOST = "https://api.stability.ai";

export interface StabilityImageResponse {
  image: string; // Base64 encoded image
  mimeType: string;
  seed: number;
  finishReason: "SUCCESS" | "CONTENT_FILTERED" | "ERROR";
}

// ============================================================================
// Helpers
// ============================================================================

export function getContentType(format: string): string {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

// ============================================================================
// Multipart Form Data Builder
// ============================================================================

function buildMultipartFormData(
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Buffer; filename: string } | undefined>
): { body: Buffer; contentType: string } {
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  const parts: Buffer[] = [];

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

  for (const [key, file] of Object.entries(files)) {
    if (!file) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"; filename="${file.filename}"\r\n` +
          `Content-Type: application/octet-stream\r\n\r\n`
      )
    );
    parts.push(file.buffer);
    parts.push(Buffer.from("\r\n"));
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ============================================================================
// API Calls
// ============================================================================

/**
 * Call Stability AI v2beta API (multipart form)
 */
export async function callStabilityApi(
  endpoint: string,
  apiKey: string,
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Buffer; filename: string } | undefined>,
  outputFormat = "png"
): Promise<StabilityImageResponse> {
  const { body, contentType } = buildMultipartFormData(
    { ...fields, output_format: outputFormat },
    files
  );

  const response = await fetch(`${STABILITY_API_HOST}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": contentType,
      Accept: "application/json",
    },
    body: new Uint8Array(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Stability API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;

  // Handle array response (v2beta returns array)
  interface StabilityArtifact {
    base64?: string;
    image?: string;
    seed?: number;
    finish_reason?: string;
    finishReason?: string;
  }
  const artifacts = data.artifacts as StabilityArtifact[] | undefined;
  const artifact: StabilityArtifact = artifacts?.[0] ?? (data as StabilityArtifact);

  const imageData = artifact.base64 || artifact.image;
  if (!imageData) {
    throw new Error("No image data in Stability API response");
  }

  const finishReason = artifact.finish_reason || artifact.finishReason || "SUCCESS";
  const validFinishReasons = ["SUCCESS", "CONTENT_FILTERED", "ERROR"] as const;
  const normalizedFinishReason = validFinishReasons.includes(
    finishReason as (typeof validFinishReasons)[number]
  )
    ? (finishReason as StabilityImageResponse["finishReason"])
    : "SUCCESS";

  return {
    image: imageData,
    mimeType: getContentType(outputFormat),
    seed: artifact.seed ?? 0,
    finishReason: normalizedFinishReason,
  };
}

/**
 * Call Stability AI v1 API (JSON body, for text-to-image)
 */
export async function callStabilityApiV1(
  endpoint: string,
  apiKey: string,
  body: Record<string, unknown>,
  outputFormat = "png"
): Promise<StabilityImageResponse> {
  console.log("[stability-api] V1 request to:", `${STABILITY_API_HOST}${endpoint}`);
  console.log("[stability-api] Request body:", JSON.stringify(body, null, 2));

  const response = await fetch(`${STABILITY_API_HOST}${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  console.log("[stability-api] Response status:", response.status);

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[stability-api] Error response:", errorText);
    throw new Error(`Stability API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  console.log(
    "[stability-api] Response received, artifacts count:",
    (data.artifacts as unknown[])?.length ?? "N/A"
  );

  interface StabilityArtifact {
    base64?: string;
    seed?: number;
    finishReason?: string;
  }
  const artifacts = data.artifacts as StabilityArtifact[] | undefined;
  const artifact = artifacts?.[0];

  if (!artifact || !artifact.base64) {
    throw new Error("No image returned from Stability API");
  }

  const finishReason = artifact.finishReason || "SUCCESS";
  const validFinishReasons = ["SUCCESS", "CONTENT_FILTERED", "ERROR"] as const;
  const normalizedFinishReason = validFinishReasons.includes(
    finishReason as (typeof validFinishReasons)[number]
  )
    ? (finishReason as StabilityImageResponse["finishReason"])
    : "SUCCESS";

  return {
    image: artifact.base64,
    mimeType: getContentType(outputFormat),
    seed: artifact.seed ?? 0,
    finishReason: normalizedFinishReason,
  };
}
