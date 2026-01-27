# AWP Image Workshop

AI-powered image generation and editing workshop using Agent Web Portal framework.

## Overview

This package provides MCP (Model Context Protocol) tools for AI image generation and editing, powered by:

- **Stability AI**: Stable Diffusion Ultra, ControlNet, image editing
- **Black Forest Labs**: FLUX Pro 1.1, FLUX Kontext, FLUX Fill

## Quick Start

### Installation

```bash
bun install
```

### Development

```bash
# Build
bun run build

# Type check
bun run typecheck

# Lint
bun run lint
```

### Deployment

```bash
# Deploy to dev
sam build && sam deploy --config-env dev

# Deploy to prod
sam build && sam deploy --config-env prod
```

## Architecture

### Skills

1. **stability-image-generation**: 11 tools for Stability AI
   - txt2img, erase, inpaint, outpaint, remove_bg
   - search_replace, search_recolor
   - sketch, structure, style, transfer

2. **flux-image-generation**: 5 tools for FLUX
   - flux_pro, flux_flex, flux_kontext
   - flux_fill, flux_expand

### Authentication

Simple HMAC-SHA256 authentication on MCP endpoints:

```
X-Signature: sha256=<hmac>
X-Timestamp: <unix-timestamp>
```

Signature is computed as: `HMAC-SHA256(secret, timestamp + body)`

### Blob Handling

Uses AWP's blob mechanism:

- Input blobs: Pre-signed GET URLs via `context.blobs.input.<field>`
- Output blobs: Pre-signed PUT URLs via `context.blobs.output.<field>`

## API Reference

### Stability AI Tools

| Tool | Description |
|------|-------------|
| `txt2img` | Generate image from text prompt |
| `erase` | Remove objects using mask |
| `inpaint` | Fill masked regions |
| `outpaint` | Extend image boundaries |
| `remove_bg` | Remove background |
| `search_replace` | Find and replace objects |
| `search_recolor` | Find and recolor objects |
| `sketch` | Generate from sketch |
| `structure` | Generate from edge/depth map |
| `style` | Apply style reference |
| `transfer` | Transfer style between images |

### FLUX Tools

| Tool | Description |
|------|-------------|
| `flux_pro` | High-quality text-to-image |
| `flux_flex` | Flexible generation with guidance |
| `flux_kontext` | Context-aware editing |
| `flux_fill` | Inpaint masked regions |
| `flux_expand` | Outpaint/expand canvas |

## Configuration

### AWS Secrets

Store API keys in AWS Secrets Manager:

```bash
# Stability AI
aws secretsmanager create-secret \
  --name awp-image-workshop/stability-api-key \
  --secret-string "sk-..."

# Black Forest Labs
aws secretsmanager create-secret \
  --name awp-image-workshop/bfl-api-key \
  --secret-string "..."

# HMAC Secret
aws secretsmanager create-secret \
  --name awp-image-workshop/hmac-secret \
  --secret-string "your-secret-key"
```

## License

MIT
