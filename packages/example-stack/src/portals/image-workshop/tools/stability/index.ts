/**
 * Stability AI Tools Index
 *
 * Exports all Stability AI image generation and editing tools
 */

export { eraseTool } from "./erase.ts";
export { inpaintTool } from "./inpaint.ts";
export { outpaintTool } from "./outpaint.ts";
export { removeBgTool } from "./remove-bg.ts";
export { searchRecolorTool } from "./search-recolor.ts";
export { searchReplaceTool } from "./search-replace.ts";
export { sketchTool } from "./sketch.ts";
export { structureTool } from "./structure.ts";
export { styleTool } from "./style.ts";
export { transferTool } from "./transfer.ts";
export { txt2imgTool } from "./txt2img.ts";

import { eraseTool } from "./erase.ts";
import { inpaintTool } from "./inpaint.ts";
import { outpaintTool } from "./outpaint.ts";
import { removeBgTool } from "./remove-bg.ts";
import { searchRecolorTool } from "./search-recolor.ts";
import { searchReplaceTool } from "./search-replace.ts";
import { sketchTool } from "./sketch.ts";
import { structureTool } from "./structure.ts";
import { styleTool } from "./style.ts";
import { transferTool } from "./transfer.ts";
import { txt2imgTool } from "./txt2img.ts";

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
