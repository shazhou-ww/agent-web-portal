/**
 * AWP Image Workshop Portal
 *
 * Defines the Agent Web Portal with skills and tools registration
 */

import { AgentWebPortalBuilder } from '@agent-web-portal/core';
import { fluxTools } from './tools/flux/index.js';
import { stabilityTools } from './tools/stability/index.js';

/**
 * Create the portal using the builder pattern
 */
const builder = new AgentWebPortalBuilder();

// Register all tools
for (const tool of [...stabilityTools, ...fluxTools]) {
  builder.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    // biome-ignore lint/suspicious/noExplicitAny: AWP handler types are complex, using any for compatibility
    handler: tool.handler as any,
  });
}

// Register skills
builder.registerSkills({
  'stability-image-generation': {
    url: '/skills/stability-image-generation.md',
    frontmatter: {
      name: 'Stability Image Generation',
      description: 'Professional AI image generation and editing using Stability AI',
      version: '1.0.0',
      'allowed-tools': stabilityTools.map((t) => t.name),
    },
  },
  'flux-image-generation': {
    url: '/skills/flux-image-generation.md',
    frontmatter: {
      name: 'FLUX Image Generation',
      description: 'State-of-the-art AI image generation using Black Forest Labs FLUX models',
      version: '1.0.0',
      'allowed-tools': fluxTools.map((t) => t.name),
    },
  },
});

/**
 * Image Workshop Portal instance
 */
export const portal = builder.build();
