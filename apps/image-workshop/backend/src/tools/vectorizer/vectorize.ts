/**
 * Vectorize Tool (Vectorizer.AI)
 *
 * Convert bitmap images to vector format (SVG, EPS, PDF, DXF)
 * Supports line art generation via stroke_edges draw style
 */

import { defineTool } from "@agent-web-portal/awp-server-core";
import { z } from "zod";
import {
  type VectorizerDrawStyle,
  type VectorizerGroupBy,
  type VectorizerOutputFormat,
  type VectorizerShapeStacking,
  vectorizeImage,
} from "../../lib/vectorizer-api.ts";
import { getVectorizerCredentials } from "../../secrets.ts";

export const vectorizeTool = defineTool((cas) => ({
  name: "vectorize",
  description:
    "Convert a bitmap image (PNG, JPEG, etc.) to vector format (SVG, EPS, PDF). " +
    "Use draw_style='stroke_edges' for line art/sketch effect. " +
    "Use max_colors=1 or 2 for simpler line drawings.",
  inputSchema: z.object({
    imageKey: z.string().describe("CAS key of the source bitmap image"),
    output_format: z
      .enum(["svg", "eps", "pdf", "dxf", "png"])
      .default("svg")
      .describe("Output file format. SVG is recommended for web use, EPS/PDF for print."),
    draw_style: z
      .enum(["fill_shapes", "stroke_shapes", "stroke_edges"])
      .optional()
      .describe(
        "How shapes are drawn. 'fill_shapes' (default) for filled regions, " +
          "'stroke_shapes' for outlined shapes, 'stroke_edges' for line art/sketch effect."
      ),
    max_colors: z
      .number()
      .int()
      .min(0)
      .max(256)
      .optional()
      .describe(
        "Maximum number of colors in output. 0 = unlimited (default). " +
          "Use 1-2 for simple line drawings, higher values for detailed illustrations."
      ),
    palette: z
      .string()
      .optional()
      .describe(
        "Color palette for constraining/snapping colors. Format: comma-separated hex colors " +
          "(e.g., '#FF0000,#00FF00,#0000FF') or preset name."
      ),
    shape_stacking: z
      .enum(["cutouts", "stacked"])
      .optional()
      .describe(
        "How overlapping shapes are handled. 'cutouts' (default) cuts holes, " +
          "'stacked' layers shapes on top of each other."
      ),
    group_by: z
      .enum(["none", "color", "parent", "layer"])
      .optional()
      .describe(
        "How shapes are grouped in output. 'none' = flat, 'color' = by color, " +
          "'parent' = by parent shape, 'layer' = by layer."
      ),
    min_area_px: z
      .number()
      .min(0)
      .max(100)
      .optional()
      .describe("Minimum shape area in pixels (0-100). Shapes smaller than this are removed."),
    max_pixels: z
      .number()
      .int()
      .min(100)
      .max(3145828)
      .optional()
      .describe("Maximum input pixels before shrinking. Default ~2MP, max ~3MP."),
  }),
  outputSchema: z.object({
    resultKey: z.string().describe("CAS key of the vectorized output file"),
    metadata: z.object({
      format: z.string().describe("Output format (svg, eps, pdf, dxf, png)"),
      mimeType: z.string().describe("MIME type of the output"),
      creditsCharged: z.number().describe("Vectorizer.AI credits charged for this operation"),
    }),
  }),
  handler: async (args) => {
    const credentials = await getVectorizerCredentials();

    // Read input image from CAS
    const imageHandle = await cas.openFile(args.imageKey);
    const imageData = await imageHandle.bytes();

    // Call Vectorizer.AI API
    const response = await vectorizeImage(imageData, credentials, {
      outputFormat: args.output_format as VectorizerOutputFormat,
      drawStyle: args.draw_style as VectorizerDrawStyle | undefined,
      maxColors: args.max_colors,
      palette: args.palette,
      shapeStacking: args.shape_stacking as VectorizerShapeStacking | undefined,
      groupBy: args.group_by as VectorizerGroupBy | undefined,
      minAreaPx: args.min_area_px,
      maxPixels: args.max_pixels,
    });

    // Write vectorized output to CAS
    const resultKey = await cas.putFile(response.data, response.mimeType);

    return {
      resultKey,
      metadata: {
        format: args.output_format,
        mimeType: response.mimeType,
        creditsCharged: response.creditsCharged,
      },
    };
  },
}));
