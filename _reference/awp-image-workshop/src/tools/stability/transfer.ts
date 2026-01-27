/**
 * Style Transfer Tool (Stability AI)
 *
 * Transfers style from one image to another
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const transferTool = defineTool({
  name: 'transfer',
  description: 'Transfer the style from a reference image to a content image',

  input: {
    init_image: blob({ mimeType: 'image/*', description: 'Content image' }),
    style_image: blob({ mimeType: 'image/*', description: 'Style reference image' }),
    prompt: z.string().default('').describe('Optional text prompt to guide the style transfer'),
    fidelity: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe('How closely to match the style (0-1)'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Style-transferred image' }),
    metadata: z.object({
      seed: z.number().describe('Seed used for generation'),
      finish_reason: z.string().describe('Reason generation finished'),
    }),
  },

  handler: async (args, context) => {
    const apiKey = await getStabilityApiKey();

    const [contentResponse, styleResponse] = await Promise.all([
      fetch(context.blobs.input.init_image),
      fetch(context.blobs.input.style_image),
    ]);

    const contentBuffer = Buffer.from(await contentResponse.arrayBuffer());
    const styleBuffer = Buffer.from(await styleResponse.arrayBuffer());

    const response = await callStabilityApi(
      '/v2beta/stable-image/control/style',
      apiKey,
      {
        prompt: args.prompt,
        fidelity: args.fidelity,
        seed: args.seed,
        output_format: args.output_format,
      },
      {
        image: { buffer: contentBuffer, filename: 'content.png' },
        style_image: { buffer: styleBuffer, filename: 'style.png' },
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
