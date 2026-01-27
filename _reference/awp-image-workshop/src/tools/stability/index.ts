/**
 * Stability AI Tools Index
 *
 * Exports all Stability AI image generation and editing tools
 */

export { eraseTool } from './erase.js';
export { inpaintTool } from './inpaint.js';
export { outpaintTool } from './outpaint.js';
export { removeBgTool } from './remove-bg.js';
export { searchRecolorTool } from './search-recolor.js';
export { searchReplaceTool } from './search-replace.js';
export { sketchTool } from './sketch.js';
export { structureTool } from './structure.js';
export { styleTool } from './style.js';
export { transferTool } from './transfer.js';
export { txt2imgTool } from './txt2img.js';

import { eraseTool } from './erase.js';
import { inpaintTool } from './inpaint.js';
import { outpaintTool } from './outpaint.js';
import { removeBgTool } from './remove-bg.js';
import { searchRecolorTool } from './search-recolor.js';
import { searchReplaceTool } from './search-replace.js';
import { sketchTool } from './sketch.js';
import { structureTool } from './structure.js';
import { styleTool } from './style.js';
import { transferTool } from './transfer.js';
import { txt2imgTool } from './txt2img.js';

/**
 * All Stability AI tools as an array for registration
 */
export const stabilityTools = [
  txt2imgTool,
  eraseTool,
  inpaintTool,
  outpaintTool,
  removeBgTool,
  searchReplaceTool,
  searchRecolorTool,
  sketchTool,
  structureTool,
  styleTool,
  transferTool,
];
