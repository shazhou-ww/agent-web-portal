/**
 * FLUX Flex Tool (Black Forest Labs)
 *
 * Flexible image generation with style control
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callBflApi, getContentType } from '../../lib/bfl-api.js';
import { getBflApiKey } from '../../secrets.js';

export const fluxFlexTool = defineTool({
  name: 'flux_flex',
  description: 'Generate an image with flexible style options using FLUX Flex',

  input: {
    prompt: z.string().describe('Text prompt describing the image to generate'),
    width: z.number().min(256).max(1440).default(1024).describe('Image width'),
    height: z.number().min(256).max(1440).default(1024).describe('Image height'),
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
    image: blob({ mimeType: 'image/png', description: 'Generated image' }),
    metadata: z.object({
      id: z.string().describe('Task ID from BFL API'),
      seed: z.number().optional().describe('Seed used for generation'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getBflApiKey();

    const result = await callBflApi('/v1/flux-dev', apiKey, {
      prompt: args.prompt,
      width: args.width,
      height: args.height,
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
