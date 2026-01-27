/**
 * Outpaint Tool (Stability AI)
 *
 * Extends images beyond their original boundaries
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const outpaintTool = defineTool({
  name: 'outpaint',
  description: 'Extend an image beyond its original boundaries',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Source image' }),
    prompt: z.string().optional().describe('Text prompt to guide the outpainted content'),
    left: z.number().min(0).default(0).describe('Pixels to extend on the left'),
    right: z.number().min(0).default(0).describe('Pixels to extend on the right'),
    up: z.number().min(0).default(0).describe('Pixels to extend upward'),
    down: z.number().min(0).default(0).describe('Pixels to extend downward'),
    creativity: z.number().min(0).max(1).default(0.5).describe('Creativity level (0-1)'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Extended image' }),
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
      '/v2beta/stable-image/edit/outpaint',
      apiKey,
      {
        prompt: args.prompt,
        left: args.left,
        right: args.right,
        up: args.up,
        down: args.down,
        creativity: args.creativity,
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
