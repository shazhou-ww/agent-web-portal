/**
 * Search and Replace Tool (Stability AI)
 *
 * Finds and replaces objects in images using text descriptions
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const searchReplaceTool = defineTool({
  name: 'search_replace',
  description: 'Search for an object in an image and replace it with something else',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Source image' }),
    prompt: z.string().describe('Text prompt describing what to replace the found object with'),
    search_prompt: z.string().describe('Text prompt describing what to search for'),
    negative_prompt: z.string().optional().describe('What to avoid in the replacement'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Result image with replaced object' }),
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
      '/v2beta/stable-image/edit/search-and-replace',
      apiKey,
      {
        prompt: args.prompt,
        search_prompt: args.search_prompt,
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
