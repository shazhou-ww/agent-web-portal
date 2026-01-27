/**
 * Style Control Tool (Stability AI)
 *
 * Applies style references to generated images
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const styleTool = defineTool({
  name: 'style',
  description: 'Generate an image using a style reference image',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Style reference image' }),
    prompt: z.string().describe('Text prompt describing what to generate'),
    negative_prompt: z.string().optional().describe('What to avoid in the generated image'),
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
    image: blob({ mimeType: 'image/png', description: 'Generated image with applied style' }),
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
      '/v2beta/stable-image/control/style',
      apiKey,
      {
        prompt: args.prompt,
        negative_prompt: args.negative_prompt,
        fidelity: args.fidelity,
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
