/**
 * Erase Tool (Stability AI)
 *
 * Removes objects from images using a mask
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const eraseTool = defineTool({
  name: 'erase',
  description: 'Erase objects from an image using a mask (white areas are erased)',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Source image' }),
    mask: blob({ mimeType: 'image/*', description: 'Mask image (white=erase, black=keep)' }),
    grow_mask: z.number().min(0).max(100).default(5).describe('Pixels to grow the mask by'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Result image with erased areas' }),
    metadata: z.object({
      seed: z.number().describe('Seed used for generation'),
      finish_reason: z.string().describe('Reason generation finished'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getStabilityApiKey();

    // Fetch input blobs from presigned URLs
    const [imageResponse, maskResponse] = await Promise.all([
      fetch(context.blobs.input.image),
      fetch(context.blobs.input.mask),
    ]);

    const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
    const maskBuffer = Buffer.from(await maskResponse.arrayBuffer());

    const response = await callStabilityApi(
      '/v2beta/stable-image/edit/erase',
      apiKey,
      {
        grow_mask: args.grow_mask,
        seed: args.seed,
        output_format: args.output_format,
      },
      {
        image: { buffer: imageBuffer, filename: 'image.png' },
        mask: { buffer: maskBuffer, filename: 'mask.png' },
      },
      args.output_format
    );

    // Write output blob
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
