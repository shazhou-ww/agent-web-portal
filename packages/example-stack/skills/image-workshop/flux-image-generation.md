# FLUX Image Generation

State-of-the-art AI image generation using Black Forest Labs' FLUX models.

## Overview

This skill provides access to FLUX, one of the most advanced AI image generation models available. FLUX excels at photorealistic imagery, complex compositions, and accurate text rendering in images.

## Capabilities

### Text-to-Image
- **flux_pro**: High-quality image generation with FLUX Pro 1.1
- **flux_flex**: Flexible generation with adjustable guidance scale

### Image Editing
- **flux_kontext**: Context-aware image editing and transformation
- **flux_fill**: Inpaint/fill masked regions of images
- **flux_expand**: Outpaint/extend images beyond boundaries

## Key Features

### Superior Quality
FLUX Pro 1.1 represents the cutting edge of image generation, with:
- Exceptional photorealism
- Accurate text rendering in images
- Complex multi-subject compositions
- Consistent style and coherence

### Context Understanding
FLUX Kontext understands image context to make intelligent edits:
- Object modification while preserving surroundings
- Style transformation with content preservation
- Seamless blending of edited regions

## Usage Examples

### Generate High-Quality Image
```
User: Create a professional product photo of a smartwatch
Agent: I'll use flux_pro for photorealistic product photography.
```

### Edit with Context
```
User: Change the season in this photo from summer to winter
Agent: I'll use flux_kontext to transform the scene while keeping subjects.
```

### Expand Canvas
```
User: Extend this portrait to show more of the background
Agent: I'll use flux_expand to outpaint the image boundaries.
```

### Fill Region
```
User: Replace the sky with a sunset
Agent: I'll use flux_fill with a mask of the sky area.
```

## Parameters

### Common Parameters
- **prompt**: Text description of desired output
- **width/height**: Output dimensions (256-1440)
- **seed**: Random seed for reproducibility
- **output_format**: png or jpeg

### Generation Parameters
- **guidance**: Guidance scale (1.5-5, default 3.5)
- **prompt_upsampling**: Auto-enhance prompts with details
- **safety_tolerance**: Content filter level (0-6)

### Expand Parameters
- **top/bottom/left/right**: Pixels to expand in each direction

## Best Practices

1. **Prompt Upsampling**: Enable for more detailed results
2. **Guidance Scale**: Lower (2-3) for creative freedom, higher (4-5) for prompt adherence
3. **Safety Tolerance**: Adjust based on content needs
4. **Seed Usage**: Save seeds to reproduce or iterate on good results

## Limitations

- Async processing with polling (may take 10-60 seconds)
- Maximum dimensions: 1440x1440 pixels
- Some content filtered by safety systems
- API rate limits apply
