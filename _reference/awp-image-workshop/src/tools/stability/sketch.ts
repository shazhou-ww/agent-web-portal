/**
 * Sketch Control Tool (Stability AI)
 *
 * Generates images from sketch inputs
 */

import { blob, defineTool } from '@agent-web-portal/core';
import { z } from 'zod';
import { callStabilityApi, getContentType } from '../../lib/stability-api.js';
import { getStabilityApiKey } from '../../secrets.js';

export const sketchTool = defineTool({
  name: 'sketch',
  description: 'Generate an image from a sketch using ControlNet',

  input: {
    image: blob({ mimeType: 'image/*', description: 'Sketch image' }),
    prompt: z.string().describe('Text prompt describing what to generate'),
    negative_prompt: z.string().optional().describe('What to avoid in the generated image'),
    control_strength: z
      .number()
      .min(0)
      .max(1)
      .default(0.7)
      .describe('How strongly the sketch influences the output'),
    seed: z.number().optional().describe('Random seed for reproducibility'),
    output_format: z.enum(['png', 'jpeg', 'webp']).default('png').describe('Output image format'),
  },

  output: {
    image: blob({ mimeType: 'image/png', description: 'Generated image from sketch' }),
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
      '/v2beta/stable-image/control/sketch',
      apiKey,
      {
        prompt: args.prompt,
        negative_prompt: args.negative_prompt,
        control_strength: args.control_strength,
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
