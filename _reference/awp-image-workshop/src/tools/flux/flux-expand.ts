/**
 * FLUX Expand Tool (Black Forest Labs)
 *
 * Outpainting with FLUX models
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callBflApi, getContentType, urlToBase64 } from '../../lib/bfl-api.js';
import { getBflApiKey } from '../../secrets.js';

export const fluxExpandTool = defineTool({
  name: 'flux_expand',
  description: 'Expand an image beyond its original boundaries using FLUX',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Input image to expand' }),
    prompt: z.string().describe('Text prompt describing the expanded content'),
    top: z.number().min(0).max(2048).default(256).describe('Pixels to expand upward'),
    bottom: z.number().min(0).max(2048).default(256).describe('Pixels to expand downward'),
    left: z.number().min(0).max(2048).default(256).describe('Pixels to expand left'),
    right: z.number().min(0).max(2048).default(256).describe('Pixels to expand right'),
    prompt_upsampling: z
      .boolean()
      .default(false)
      .describe('Whether to enhance the prompt with more details'),
    safety_tolerance: z
      .number()
      .min(0)
      .max(6)
      .default(2)
      .describe('Safety filter tolerance (0=strict, 6=permissive)'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Expanded image' }),
    metadata: z.object({
      id: z.string().describe('Task ID from BFL API'),
      seed: z.number().optional().describe('Seed used for generation'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getBflApiKey();

    const imageBase64 = await urlToBase64(context.blobs.input.image);

    const result = await callBflApi('/v1/flux-pro-1.1-canny-expand', apiKey, {
      prompt: args.prompt,
      image: imageBase64,
      top: args.top,
      bottom: args.bottom,
      left: args.left,
      right: args.right,
      prompt_upsampling: args.prompt_upsampling,
      safety_tolerance: args.safety_tolerance,
      seed: args.seed,
      output_format: args.output_format,
    });

    const imageResponse = await fetch(result.imageUrl);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const contentType = getContentType(args.output_format);

    await fetch(context.blobs.output.image, {
      method: 'PUT',
      body: imageBuffer,
      headers: { 'Content-Type': contentType },
    });

    return {
      metadata: {
        id: result.id,
        seed: result.seed,
      },
    };
  },
});
