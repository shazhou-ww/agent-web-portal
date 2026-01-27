/**
 * FLUX Fill Tool (Black Forest Labs)
 *
 * Inpainting with FLUX models
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callBflApi, getContentType, urlToBase64 } from '../../lib/bfl-api.js';
import { getBflApiKey } from '../../secrets.js';

export const fluxFillTool = defineTool({
  name: 'flux_fill',
  description: 'Fill or inpaint masked regions of an image using FLUX Fill',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Input image to inpaint' }),
    mask: blob({
      mimeType: 'image/*',
      description: 'Mask indicating regions to fill (white = fill)',
    }),
    prompt: z.string().describe('Text prompt describing what to fill in the masked region'),
    guidance: z.number().min(1.5).max(5).default(3.5).describe('Guidance scale for generation'),
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
    image: blob({ mimeType: 'image/png', description: 'Inpainted image' }),
    metadata: z.object({
      id: z.string().describe('Task ID from BFL API'),
      seed: z.number().optional().describe('Seed used for generation'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getBflApiKey();

    const [imageBase64, maskBase64] = await Promise.all([
      urlToBase64(context.blobs.input.image),
      urlToBase64(context.blobs.input.mask),
    ]);

    const result = await callBflApi('/v1/flux-pro-1.1-fill', apiKey, {
      prompt: args.prompt,
      image: imageBase64,
      mask: maskBase64,
      guidance: args.guidance,
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
