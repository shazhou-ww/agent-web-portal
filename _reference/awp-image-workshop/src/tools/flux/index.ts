/**
 * FLUX Tools Index
 *
 * Exports all Black Forest Labs FLUX image generation tools
 */

export { fluxExpandTool } from './flux-expand.js';
export { fluxFillTool } from './flux-fill.js';
export { fluxFlexTool } from './flux-flex.js';
export { fluxKontextTool } from './flux-kontext.js';
export { fluxProTool } from './flux-pro.js';

import { fluxExpandTool } from './flux-expand.js';
import { fluxFillTool } from './flux-fill.js';
import { fluxFlexTool } from './flux-flex.js';
import { fluxKontextTool } from './flux-kontext.js';
import { fluxProTool } from './flux-pro.js';

/**
 * All FLUX tools as an array for registration
 */
export const fluxTools = [fluxProTool, fluxFlexTool, fluxKontextTool, fluxFillTool, fluxExpandTool];
