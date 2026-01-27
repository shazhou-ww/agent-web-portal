# Stability Image Generation

Professional AI image generation and editing using Stability AI's APIs.

## Overview

This skill provides comprehensive image generation and manipulation capabilities powered by Stability AI's Stable Diffusion models. Generate images from text, edit existing images, remove backgrounds, and apply creative transformations.

## Capabilities

### Text-to-Image
- **txt2img**: Generate images from text descriptions using Stable Diffusion XL

### Image Editing
- **erase**: Remove unwanted objects from images using mask-based erasing
- **inpaint**: Fill masked regions with AI-generated content
- **outpaint**: Extend images beyond their original boundaries
- **remove_bg**: Remove image backgrounds cleanly

### Search & Replace
- **search_replace**: Find and replace objects in images using text descriptions
- **search_recolor**: Find and recolor specific objects in images

### Control & Style
- **sketch**: Generate images from sketch inputs using ControlNet
- **structure**: Generate images following structural edge/depth maps
- **style**: Apply style references to generated images
- **transfer**: Transfer artistic styles between images

## Usage Examples

### Generate an Image
```
User: Generate a beautiful sunset over mountains
Agent: I'll use txt2img to create that image for you.
```

### Remove Background
```
User: Remove the background from this photo
Agent: I'll use remove_bg to extract the subject cleanly.
```

### Replace Objects
```
User: Replace the cat with a dog in this image
Agent: I'll use search_replace to find the cat and replace it with a dog.
```

### Apply Style
```
User: Make this photo look like a Van Gogh painting
Agent: I'll use the style tool with a Van Gogh reference image.
```

## Parameters

### Common Parameters
- **prompt**: Text description of desired output
- **negative_prompt**: What to avoid in the output
- **seed**: Random seed for reproducibility
- **output_format**: png, jpeg, or webp

### Control Parameters
- **control_strength**: How strongly control images influence output (0-1)
- **fidelity**: How closely to match style references (0-1)

## Best Practices

1. **Be Descriptive**: More detailed prompts yield better results
2. **Use Negative Prompts**: Exclude unwanted elements explicitly
3. **Control Strength**: Start with 0.7 and adjust as needed
4. **Quality Masks**: Clean, precise masks produce better inpaint/erase results

## Limitations

- Maximum image resolution: 2048x2048 for most operations
- Processing time varies by complexity
- Some content may be filtered by safety systems
