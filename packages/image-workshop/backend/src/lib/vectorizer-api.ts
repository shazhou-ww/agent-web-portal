/**
 * Vectorizer.AI API Client
 *
 * Utilities for interacting with Vectorizer.AI bitmap-to-vector conversion API
 * https://vectorizer.ai/api
 */

// ============================================================================
// Constants & Types
// ============================================================================

export const VECTORIZER_API_HOST = "https://api.vectorizer.ai";

export type VectorizerOutputFormat = "svg" | "eps" | "pdf" | "dxf" | "png";
export type VectorizerDrawStyle = "fill_shapes" | "stroke_shapes" | "stroke_edges";
export type VectorizerShapeStacking = "cutouts" | "stacked";
export type VectorizerGroupBy = "none" | "color" | "parent" | "layer";
export type VectorizerMode = "production" | "preview" | "test" | "test_preview";

export interface VectorizerOptions {
  /** Output file format */
  outputFormat?: VectorizerOutputFormat;
  /** How shapes are drawn (fill_shapes, stroke_shapes, stroke_edges for line art) */
  drawStyle?: VectorizerDrawStyle;
  /** How overlapping shapes are handled */
  shapeStacking?: VectorizerShapeStacking;
  /** How shapes are grouped in output */
  groupBy?: VectorizerGroupBy;
  /** Maximum number of colors (0 = unlimited, 1-256 for limited palette) */
  maxColors?: number;
  /** Color palette for snapping/constraining colors */
  palette?: string;
  /** Minimum shape area in pixels (0-100) */
  minAreaPx?: number;
  /** Maximum input pixels before shrinking (100-3145828) */
  maxPixels?: number;
  /** Processing mode (production, preview, test, test_preview) */
  mode?: VectorizerMode;
}

export interface VectorizerResponse {
  /** Binary content of the vectorized output */
  data: Uint8Array;
  /** MIME type of the output */
  mimeType: string;
  /** Credits charged for this operation */
  creditsCharged: number;
  /** Token for downloading other formats (if retention enabled) */
  imageToken?: string;
}

// Re-export VectorizerCredentials type from secrets
import type { VectorizerCredentials } from "../secrets.ts";

export type { VectorizerCredentials } from "../secrets.ts";

// ============================================================================
// Helpers
// ============================================================================

export function getOutputMimeType(format: VectorizerOutputFormat): string {
  switch (format) {
    case "svg":
      return "image/svg+xml";
    case "eps":
      return "application/postscript";
    case "pdf":
      return "application/pdf";
    case "dxf":
      return "application/dxf";
    case "png":
      return "image/png";
    default:
      return "image/svg+xml";
  }
}

// ============================================================================
// Multipart Form Data Builder
// ============================================================================

/**
 * Detect image MIME type from binary data
 */
function detectImageMimeType(data: Uint8Array): { mimeType: string; extension: string } {
  // Check magic bytes
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46) {
    return { mimeType: "image/gif", extension: "gif" };
  }
  if (data[0] === 0x42 && data[1] === 0x4d) {
    return { mimeType: "image/bmp", extension: "bmp" };
  }
  if (
    (data[0] === 0x49 && data[1] === 0x49 && data[2] === 0x2a && data[3] === 0x00) ||
    (data[0] === 0x4d && data[1] === 0x4d && data[2] === 0x00 && data[3] === 0x2a)
  ) {
    return { mimeType: "image/tiff", extension: "tiff" };
  }
  // Default to PNG
  return { mimeType: "image/png", extension: "png" };
}

function buildMultipartFormData(
  fields: Record<string, string | number | undefined>,
  files: Record<string, { buffer: Uint8Array; filename: string; mimeType: string } | undefined>
): { body: Uint8Array; contentType: string } {
  const boundary = `----FormBoundary${Date.now()}${Math.random().toString(36).substring(2)}`;
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(
      encoder.encode(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${value}\r\n`
      )
    );
  }

  for (const [key, file] of Object.entries(files)) {
    if (!file) continue;
    parts.push(
      encoder.encode(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.mimeType}\r\n\r\n`
      )
    );
    parts.push(file.buffer);
    parts.push(encoder.encode("\r\n"));
  }

  parts.push(encoder.encode(`--${boundary}--\r\n`));

  // Concatenate all parts
  const totalLength = parts.reduce((acc, part) => acc + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return {
    body: result,
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

// ============================================================================
// API Functions
// ============================================================================

/**
 * Convert a bitmap image to vector format using Vectorizer.AI
 *
 * @param imageData - Binary image data (PNG, JPEG, BMP, GIF, TIFF)
 * @param credentials - API credentials
 * @param options - Vectorization options
 * @returns Vectorized output with metadata
 */
export async function vectorizeImage(
  imageData: Uint8Array,
  credentials: VectorizerCredentials,
  options: VectorizerOptions = {}
): Promise<VectorizerResponse> {
  const {
    outputFormat = "svg",
    drawStyle,
    shapeStacking,
    groupBy,
    maxColors,
    palette,
    minAreaPx,
    maxPixels,
    mode = "production",
  } = options;

  // Build form fields
  const fields: Record<string, string | number | undefined> = {
    mode,
    "output.file_format": outputFormat,
  };

  if (drawStyle !== undefined) {
    fields["output.draw_style"] = drawStyle;
  }
  if (shapeStacking !== undefined) {
    fields["output.shape_stacking"] = shapeStacking;
  }
  if (groupBy !== undefined) {
    fields["output.group_by"] = groupBy;
  }
  if (maxColors !== undefined) {
    fields["processing.max_colors"] = maxColors;
  }
  if (palette !== undefined) {
    fields["processing.palette"] = palette;
  }
  if (minAreaPx !== undefined) {
    fields["processing.shapes.min_area_px"] = minAreaPx;
  }
  if (maxPixels !== undefined) {
    fields["input.max_pixels"] = maxPixels;
  }

  // Detect image type from binary data
  const imageType = detectImageMimeType(imageData);

  // Debug logging
  console.log("[Vectorizer] Image data size:", imageData.length, "bytes");
  console.log("[Vectorizer] Detected type:", imageType);
  console.log(
    "[Vectorizer] First 16 bytes:",
    Array.from(imageData.slice(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")
  );

  // Build multipart form
  const { body, contentType } = buildMultipartFormData(fields, {
    image: {
      buffer: imageData,
      filename: `image.${imageType.extension}`,
      mimeType: imageType.mimeType,
    },
  });

  // Create Basic Auth header
  const authHeader = `Basic ${Buffer.from(`${credentials.apiId}:${credentials.apiSecret}`).toString("base64")}`;

  // Make API request
  const response = await fetch(`${VECTORIZER_API_HOST}/api/v1/vectorize`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      "Content-Type": contentType,
    },
    body: body as BodyInit,
  });

  if (!response.ok) {
    let errorMessage = `Vectorizer.AI API error: ${response.status} ${response.statusText}`;
    try {
      const errorData = await response.json();
      if (errorData.error) {
        errorMessage = `Vectorizer.AI API error: ${errorData.error.message || errorData.error}`;
      }
    } catch {
      // Ignore JSON parse errors
    }
    throw new Error(errorMessage);
  }

  // Read response body as binary
  const arrayBuffer = await response.arrayBuffer();
  const data = new Uint8Array(arrayBuffer);

  // Extract metadata from headers
  const creditsCharged = parseFloat(response.headers.get("X-Credits-Charged") || "0");
  const imageToken = response.headers.get("X-Image-Token") || undefined;

  return {
    data,
    mimeType: getOutputMimeType(outputFormat),
    creditsCharged,
    imageToken,
  };
}
