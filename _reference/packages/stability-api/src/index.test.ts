import { describe, expect, it, vi } from 'vitest';
import {
  STABILITY_API_HOST,
  buildMultipartFormData,
  createImageBlob,
  createImageBlobAsync,
  decodeImageInput,
  getContentType,
  isHttpUrl,
  toToolResponse,
  type StabilityImageResponse,
} from './index';

describe('stability-api', () => {
  describe('STABILITY_API_HOST', () => {
    it('should be the correct API host', () => {
      expect(STABILITY_API_HOST).toBe('https://api.stability.ai');
    });
  });

  describe('decodeImageInput', () => {
    it('should decode raw base64 string', () => {
      const base64 = Buffer.from('test image data').toString('base64');
      const result = decodeImageInput(base64);
      expect(result.toString()).toBe('test image data');
    });

    it('should decode data URL with base64 content', () => {
      const base64 = Buffer.from('test image data').toString('base64');
      const dataUrl = `data:image/png;base64,${base64}`;
      const result = decodeImageInput(dataUrl);
      expect(result.toString()).toBe('test image data');
    });
  });

  describe('isHttpUrl', () => {
    it('should return true for http URLs', () => {
      expect(isHttpUrl('http://example.com/image.png')).toBe(true);
    });

    it('should return true for https URLs', () => {
      expect(isHttpUrl('https://example.com/image.png')).toBe(true);
    });

    it('should return false for base64 strings', () => {
      expect(isHttpUrl('data:image/png;base64,abc123')).toBe(false);
    });

    it('should return false for raw base64', () => {
      expect(isHttpUrl('abc123==')).toBe(false);
    });
  });

  describe('getContentType', () => {
    it('should return correct content type for png', () => {
      expect(getContentType('png')).toBe('image/png');
    });

    it('should return correct content type for jpeg', () => {
      expect(getContentType('jpeg')).toBe('image/jpeg');
    });

    it('should return correct content type for jpg', () => {
      expect(getContentType('jpg')).toBe('image/jpeg');
    });

    it('should return correct content type for webp', () => {
      expect(getContentType('webp')).toBe('image/webp');
    });

    it('should default to png for unknown format', () => {
      expect(getContentType('unknown')).toBe('image/png');
    });
  });

  describe('createImageBlob', () => {
    it('should create blob from base64 data', () => {
      const base64 = Buffer.from('test image').toString('base64');
      const result = createImageBlob(base64, 'test.png');
      expect(result.filename).toBe('test.png');
      expect(result.buffer.toString()).toBe('test image');
    });
  });

  describe('createImageBlobAsync', () => {
    it('should create blob from base64 data', async () => {
      const base64 = Buffer.from('test image').toString('base64');
      const result = await createImageBlobAsync(base64, 'test.png');
      expect(result.filename).toBe('test.png');
      expect(result.buffer.toString()).toBe('test image');
    });

    it('should fetch from HTTP URL', async () => {
      const mockResponse = {
        ok: true,
        arrayBuffer: vi.fn().mockResolvedValue(Buffer.from('remote image').buffer),
      };
      global.fetch = vi.fn().mockResolvedValue(mockResponse) as unknown as typeof fetch;

      const result = await createImageBlobAsync('https://example.com/image.png', 'remote.png');
      expect(result.filename).toBe('remote.png');
      expect(global.fetch).toHaveBeenCalledWith('https://example.com/image.png');
    });
  });

  describe('buildMultipartFormData', () => {
    it('should build multipart form data with fields and files', () => {
      const fields = { prompt: 'test prompt', seed: 12345 };
      const files = {
        image: { buffer: Buffer.from('test image'), filename: 'test.png' },
      };

      const result = buildMultipartFormData(fields, files);
      expect(result.contentType).toMatch(/^multipart\/form-data; boundary=/);
      expect(result.body).toBeInstanceOf(Buffer);

      const bodyString = result.body.toString();
      expect(bodyString).toContain('name="prompt"');
      expect(bodyString).toContain('test prompt');
      expect(bodyString).toContain('name="seed"');
      expect(bodyString).toContain('12345');
      expect(bodyString).toContain('name="image"');
      expect(bodyString).toContain('filename="test.png"');
    });

    it('should skip undefined fields', () => {
      const fields = { prompt: 'test', seed: undefined };
      const files = {};

      const result = buildMultipartFormData(fields, files);
      const bodyString = result.body.toString();

      expect(bodyString).toContain('name="prompt"');
      expect(bodyString).not.toContain('name="seed"');
    });

    it('should skip undefined files', () => {
      const fields = {};
      const files = { image: undefined, mask: undefined };

      const result = buildMultipartFormData(fields, files);
      const bodyString = result.body.toString();

      expect(bodyString).not.toContain('name="image"');
      expect(bodyString).not.toContain('name="mask"');
    });
  });

  describe('toToolResponse', () => {
    it('should convert StabilityImageResponse to ToolResponse', () => {
      const response: StabilityImageResponse = {
        image: 'base64data',
        mimeType: 'image/png',
        seed: 12345,
        finishReason: 'SUCCESS',
      };

      const result = toToolResponse(response);
      expect(result).toEqual({
        image: 'base64data',
        mime_type: 'image/png',
        seed: 12345,
        finish_reason: 'SUCCESS',
      });
    });

    it('should handle CONTENT_FILTERED finish reason', () => {
      const response: StabilityImageResponse = {
        image: '',
        mimeType: 'image/png',
        seed: 0,
        finishReason: 'CONTENT_FILTERED',
      };

      const result = toToolResponse(response);
      expect(result.finish_reason).toBe('CONTENT_FILTERED');
    });
  });
});
