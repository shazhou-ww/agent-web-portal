/**
 * Remove Background Tool (Stability AI)
 *
 * Removes the background from images
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const removeBgTool = defineTool({
  name: 'remove_bg',
  description: 'Remove the background from an image, leaving the subject with transparency',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Source image' }),
    output_format: z
      .enum(['png', 'webp'])
      .default('png')
      .describe('Output image format (png or webp for transparency)'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Image with background removed' }),
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
      '/v2beta/stable-image/edit/remove-background',
      apiKey,
      {
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
