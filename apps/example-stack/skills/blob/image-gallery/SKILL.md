---
name: Image Gallery
description: Upload, retrieve, and manage images in cloud storage
version: 1.0.0
allowed-tools:
  - put_image
  - get_image
  - list_images
---

# Image Gallery Skill

This skill provides image management capabilities using blob storage. It supports uploading images, retrieving them by key, and listing all stored images.

## Overview

The image gallery provides three main operations:

1. **{{put_image}}** - Upload an image to storage (blob INPUT)
2. **{{get_image}}** - Retrieve a previously uploaded image by key (blob OUTPUT)
3. **{{list_images}}** - List all stored images with metadata

Images are stored with a 1-day TTL and automatically expire.

## Usage Examples

### Example 1: Upload an Image

Use {{put_image}} to upload an image to storage:

```json
{
  "contentType": "image/png"
}
```

**Blob inputs:** `image` (the image data to upload)

**Result:**

```json
{
  "key": "images/2026-01-27/1706350800000-abc123",
  "uploadedAt": "2026-01-27T12:00:00.000Z",
  "expiresAt": "2026-01-28T12:00:00.000Z"
}
```

### Example 2: Retrieve an Image

Use {{get_image}} to retrieve a previously uploaded image:

```json
{
  "key": "images/2026-01-27/1706350800000-abc123"
}
```

**Blob outputs:** `image` (the retrieved image data)

**Result:**

```json
{
  "image": "images/2026-01-27/1706350800000-abc123",
  "contentType": "image/png",
  "uploadedAt": "2026-01-27T12:00:00.000Z",
  "expiresAt": "2026-01-28T12:00:00.000Z"
}
```

### Example 3: List All Images

Use {{list_images}} to list all stored images:

```json
{}
```

**Result:**

```json
{
  "images": [
    {
      "key": "images/2026-01-27/1706350800000-abc123",
      "contentType": "image/png",
      "uploadedAt": "2026-01-27T12:00:00.000Z",
      "expiresAt": "2026-01-28T12:00:00.000Z",
      "size": 102400
    }
  ],
  "count": 1
}
```

## Tool Reference

### {{put_image}}

Upload an image to storage. Uses blob INPUT mechanism.

**Input:**

- `contentType` (string, optional): MIME type of the image (e.g., "image/png", "image/jpeg")

**Blob Input:**

- `image`: The image data provided via presigned GET URL

**Output:**

- `key` (string): Unique storage key for the image
- `uploadedAt` (string): Upload timestamp
- `expiresAt` (string): Expiration timestamp

### {{get_image}}

Retrieve a previously uploaded image. Uses blob OUTPUT mechanism.

**Input:**

- `key` (string, required): The storage key of the image to retrieve

**Blob Output:**

- `image`: The image data written to presigned PUT URL

**Output:**

- `image` (string): The image key
- `contentType` (string): MIME type of the image
- `uploadedAt` (string): Upload timestamp
- `expiresAt` (string): Expiration timestamp

### {{list_images}}

List all stored images (not expired).

**Input:** None

**Output:**

- `images` (array): List of image metadata
- `count` (number): Total number of images
