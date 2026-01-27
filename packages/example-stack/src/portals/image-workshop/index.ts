/**
 * Image Workshop Portal
 *
 * AI Image Generation and Editing Workshop using Stability AI and FLUX
 */

import { createAgentWebPortal } from "@agent-web-portal/core";
import { fluxTools } from "./tools/flux/index.ts";
import { stabilityTools } from "./tools/stability/index.ts";

/**
 * Create the Image Workshop portal with all tools registered
 */
const builder = createAgentWebPortal({
  name: "image-workshop-portal",
  version: "1.0.0",
  description: "AI Image Generation and Editing Workshop",
});

// Register all Stability AI tools
for (const tool of stabilityTools) {
  builder.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    // biome-ignore lint/suspicious/noExplicitAny: AWP handler types are complex
    handler: tool.handler as any,
  });
}

// Register all FLUX tools
for (const tool of fluxTools) {
  builder.registerTool(tool.name, {
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    // biome-ignore lint/suspicious/noExplicitAny: AWP handler types are complex
    handler: tool.handler as any,
  });
}

// Register skills
builder.registerSkills({
  "stability-image-generation": {
    url: "/skills/stability-image-generation.md",
    frontmatter: {
      name: "Stability Image Generation",
      description: "Professional AI image generation and editing using Stability AI",
      version: "1.0.0",
      "allowed-tools": stabilityTools.map((t) => t.name),
    },
  },
  "flux-image-generation": {
    url: "/skills/flux-image-generation.md",
    frontmatter: {
      name: "FLUX Image Generation",
      description: "State-of-the-art AI image generation using Black Forest Labs FLUX models",
      version: "1.0.0",
      "allowed-tools": fluxTools.map((t) => t.name),
    },
  },
});

/**
 * Image Workshop Portal instance
 */
export const imageWorkshopPortal = builder.build();
