/**
 * Image Workshop Skills
 *
 * Skill definitions embedded as strings for Lambda deployment.
 * Content is copied from the skills/ directory.
 */

import { type DefinedSkill, parseSkill } from "@agent-web-portal/awp-server-core";

// Skill contents embedded as template literals
// These are generated from the skills/ directory

const textToImageContent = `---
name: Text-to-Image Generation
description: Generate stunning images from text descriptions using state-of-the-art AI models
version: 1.0.0
allowed-tools:
  - flux_pro
  - flux_flex
---

# Text-to-Image Generation

Transform your creative ideas into stunning images using cutting-edge AI image generation models.

## Overview

This skill uses Black Forest Labs' FLUX models to generate high-quality images from text descriptions.

## Available Tools

### FLUX Models (Black Forest Labs)
- **flux_pro**: FLUX Pro 1.1 - highest quality photorealistic generation with excellent text rendering
- **flux_flex**: Flexible generation with adjustable guidance scale for creative control

## When to Use Each Tool

| Tool | Best For | Quality | Speed |
|------|----------|---------|-------|
| flux_pro | Photorealistic images, product photos, text in images | Highest | ~30s |
| flux_flex | Creative freedom, artistic styles, experimentation | High | ~20s |

## Important: Language Requirements

**⚠️ All prompts MUST be in English!**

The AI APIs only support English prompts. If the user provides a prompt in another language, you MUST translate it to detailed English descriptions before calling any image generation tool.
`;

const fluxImageGenerationContent = `---
name: FLUX Image Generation
description: State-of-the-art AI image generation using Black Forest Labs FLUX models
version: 1.0.0
allowed-tools:
  - flux_pro
  - flux_flex
  - flux_kontext
  - flux_fill
  - flux_expand
---

# FLUX Image Generation

State-of-the-art AI image generation using Black Forest Labs' FLUX models.

## Overview

This skill provides access to FLUX, one of the most advanced AI image generation models available. FLUX excels at photorealistic imagery, complex compositions, and accurate text rendering in images.

## Available Tools

### Text-to-Image
- **flux_pro**: High-quality image generation with FLUX Pro 1.1
- **flux_flex**: Flexible generation with adjustable guidance scale

### Image Editing
- **flux_kontext**: Context-aware image editing and transformation
- **flux_fill**: Inpaint/fill masked regions of images
- **flux_expand**: Outpaint/extend images beyond boundaries

## Key Features

- Exceptional photorealism
- Accurate text rendering in images
- Complex multi-subject compositions
- Consistent style and coherence

## Important: Language Requirements

**⚠️ All prompts MUST be in English!**
`;

const imageStylizationContent = `---
name: Image Stylization
description: Transform images with artistic styles, transfer aesthetics, and apply creative effects
version: 1.0.0
allowed-tools:
  - flux_kontext
---

# Image Stylization

Transform your images with artistic styles and apply creative effects using AI.

## Overview

This skill enables powerful style transformations using FLUX's context-aware editing capabilities.

## Available Tools

### FLUX-Based
- **flux_kontext**: Context-aware style and aesthetic modifications

## Usage

Use **flux_kontext** to apply holistic style changes to images through natural language instructions. It preserves the content while modifying the aesthetic.
`;

const contentReplaceContent = `---
name: Content Replace & Inpaint
description: Replace, edit, or regenerate specific regions of images using AI-powered content replacement
version: 1.0.0
allowed-tools:
  - flux_fill
  - flux_kontext
---

# Content Replace & Inpaint

Intelligently replace, edit, or regenerate specific regions of images using state-of-the-art AI models.

## Overview

This skill provides powerful content replacement capabilities using FLUX's advanced inpainting and context-aware editing.

## Available Tools

### FLUX-Based (Black Forest Labs)
- **flux_fill**: High-quality masked region filling
- **flux_kontext**: Context-aware editing - modify images based on text instructions

## Tool Comparison

| Tool | Input | Use Case | Quality |
|------|-------|----------|---------|
| flux_fill | Image + Mask + Prompt | Precise region replacement | Highest |
| flux_kontext | Image + Prompt | Context-aware edits | Highest |
`;

const imageVectorizationContent = `---
name: Image Vectorization
description: Convert bitmap images to vector graphics (SVG, EPS, PDF) and generate line art/sketches
version: 1.0.0
allowed-tools:
  - vectorize
---

# Image Vectorization

Convert bitmap images (PNG, JPEG, etc.) to high-quality vector graphics using Vectorizer.AI.

## Overview

This skill provides professional-grade bitmap-to-vector conversion, perfect for:
- Converting logos and graphics to scalable SVG
- Generating clean line art from photos
- Creating print-ready vector files (EPS, PDF)
- Extracting edge drawings and sketches

## Available Tools

- **vectorize**: Convert bitmap to vector with extensive customization options

## Common Use Cases

### 1. Basic Vectorization (Logo/Graphic)
Convert a logo or graphic to clean SVG:
\`\`\`
vectorize(imageKey, output_format="svg")
\`\`\`

### 2. Line Art / Sketch Generation
Create line drawings from photos:
\`\`\`
vectorize(imageKey, draw_style="stroke_edges", max_colors=1)
\`\`\`

### 3. Limited Color Illustration
Create stylized illustrations with limited palette:
\`\`\`
vectorize(imageKey, max_colors=8)
\`\`\`

### 4. Print-Ready Output
Generate high-quality print files:
\`\`\`
vectorize(imageKey, output_format="pdf")
vectorize(imageKey, output_format="eps")
\`\`\`

## Parameter Guide

| Parameter | Effect | Recommended For |
|-----------|--------|-----------------|
| draw_style="fill_shapes" | Filled regions (default) | Logos, icons, illustrations |
| draw_style="stroke_edges" | Line art only | Sketches, coloring pages, technical drawings |
| draw_style="stroke_shapes" | Outlined shapes | Sticker designs, cut files |
| max_colors=1-2 | Simple line drawings | Clean sketches, minimal art |
| max_colors=4-16 | Stylized illustrations | Posters, simplified graphics |
| shape_stacking="stacked" | Layered shapes | Complex illustrations with overlaps |

## Tips

- For best line art results, use high-contrast source images
- Use \`max_colors=1\` with \`draw_style="stroke_edges"\` for pure line drawings
- SVG output is best for web, EPS/PDF for professional printing
`;

/**
 * All image workshop skills
 */
export const imageWorkshopSkills: DefinedSkill[] = [
  parseSkill("text-to-image", textToImageContent),
  parseSkill("flux-image-generation", fluxImageGenerationContent),
  parseSkill("image-stylization", imageStylizationContent),
  parseSkill("content-replace", contentReplaceContent),
  parseSkill("image-vectorization", imageVectorizationContent),
];
