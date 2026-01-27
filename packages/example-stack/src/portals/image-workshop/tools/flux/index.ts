/**
 * FLUX Tools Index
 *
 * Exports all Black Forest Labs FLUX image generation tools
 */

export { fluxExpandTool } from "./flux-expand.ts";
export { fluxFillTool } from "./flux-fill.ts";
export { fluxFlexTool } from "./flux-flex.ts";
export { fluxKontextTool } from "./flux-kontext.ts";
export { fluxProTool } from "./flux-pro.ts";

import { fluxExpandTool } from "./flux-expand.ts";
import { fluxFillTool } from "./flux-fill.ts";
import { fluxFlexTool } from "./flux-flex.ts";
import { fluxKontextTool } from "./flux-kontext.ts";
import { fluxProTool } from "./flux-pro.ts";

/**
 * All FLUX tools as an array for registration
 */
export const fluxTools = [fluxProTool, fluxFlexTool, fluxKontextTool, fluxFillTool, fluxExpandTool];
