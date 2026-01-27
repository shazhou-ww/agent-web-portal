/**
 * Search and Recolor Tool (Stability AI)
 *
 * Finds objects and changes their colors
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const searchRecolorTool = defineTool({
  name: 'search_recolor',
  description: 'Search for an object in an image and change its color',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Source image' }),
    prompt: z.string().describe('Text prompt describing the new color/style'),
    select_prompt: z.string().describe('Text prompt describing what to select for recoloring'),
    negative_prompt: z.string().optional().describe('What to avoid in the recoloring'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Result image with recolored object' }),
    metadata: z.object({
      seed: z.number().describe('Seed used for generation'),
      finish_reason: z.string().describe('Reason generation finished'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getStabilityApiKey();

    const imageResponse = await fetch(context.blobs.input.image);
    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

    const response = await callStabilityApi(
      '/v2beta/stable-image/edit/search-and-recolor',
      apiKey,
      {
        prompt: args.prompt,
        select_prompt: args.select_prompt,
        negative_prompt: args.negative_prompt,
        seed: args.seed,
        output_format: args.output_format,
      },
      {
        image: { buffer: imageBuffer, filename: 'image.png' },
      },
      args.output_format
    );

    const outputBuffer = Buffer.from(response.image, 'base64');
    const contentType = getContentType(args.output_format);

    await fetch(context.blobs.output.image, {
      method: 'PUT',
      body: outputBuffer,
      headers: { 'Content-Type': contentType },
    });

    return {
      metadata: {
        seed: response.seed,
        finish_reason: response.finishReason,
      },
    };
  },
});
