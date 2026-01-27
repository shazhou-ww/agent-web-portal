import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigKeys, ConfigManager } from './index';

describe('ConfigManager', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('getConfig from environment', () => {
    it('should return value from environment variable', async () => {
      process.env.TEST_KEY = 'test-value';

      const manager = new ConfigManager({ enableCaching: false });
      const result = await manager.getConfig('TEST_KEY');

      expect(result.value).toBe('test-value');
      expect(result.source).toBe('env');
    });

    it('should use default value when env var is not set', async () => {
      const manager = new ConfigManager({ enableCaching: false });
      const result = await manager.getConfig('NON_EXISTENT_KEY', {
        defaultValue: 'default-value',
      });

      expect(result.value).toBe('default-value');
      expect(result.source).toBe('env');
    });

    it('should throw when required value is not found', async () => {
      const manager = new ConfigManager({ enableCaching: false });

      await expect(manager.getConfig('NON_EXISTENT_KEY', { required: true })).rejects.toThrow(
        'Required configuration not found'
      );
    });

    it('should prioritize env var over default value', async () => {
      process.env.TEST_KEY = 'env-value';

      const manager = new ConfigManager({ enableCaching: false });
      const result = await manager.getConfig('TEST_KEY', {
        defaultValue: 'default-value',
      });

      expect(result.value).toBe('env-value');
      expect(result.source).toBe('env');
    });
  });

  describe('getValue convenience method', () => {
    it('should return just the string value', async () => {
      process.env.TEST_KEY = 'test-value';

      const manager = new ConfigManager({ enableCaching: false });
      const value = await manager.getValue('TEST_KEY');

      expect(value).toBe('test-value');
      expect(typeof value).toBe('string');
    });
  });

  describe('caching', () => {
    it('should cache values when caching is enabled', async () => {
      process.env.TEST_KEY = 'initial-value';

      const manager = new ConfigManager({ enableCaching: true });

      // First call
      const result1 = await manager.getConfig('TEST_KEY');
      expect(result1.value).toBe('initial-value');

      // Change env var
      process.env.TEST_KEY = 'changed-value';

      // Second call should return cached value
      const result2 = await manager.getConfig('TEST_KEY');
      expect(result2.value).toBe('initial-value');

      // Clear cache and try again
      manager.clearCache();
      const result3 = await manager.getConfig('TEST_KEY');
      expect(result3.value).toBe('changed-value');
    });

    it('should not cache values when caching is disabled', async () => {
      process.env.TEST_KEY = 'initial-value';

      const manager = new ConfigManager({ enableCaching: false });

      // First call
      const result1 = await manager.getConfig('TEST_KEY');
      expect(result1.value).toBe('initial-value');

      // Change env var
      process.env.TEST_KEY = 'changed-value';

      // Second call should return new value
      const result2 = await manager.getConfig('TEST_KEY');
      expect(result2.value).toBe('changed-value');
    });
  });

  describe('ConfigKeys', () => {
    it('should have STABILITY_API_KEY defined', () => {
      expect(ConfigKeys.STABILITY_API_KEY).toBeDefined();
      expect(ConfigKeys.STABILITY_API_KEY.envKey).toBe('STABILITY_API_KEY');
      expect(ConfigKeys.STABILITY_API_KEY.secretId).toBe('mitsein-ai/stability-api-key');
    });

    it('should have HUGGINGFACE_API_KEY defined', () => {
      expect(ConfigKeys.HUGGINGFACE_API_KEY).toBeDefined();
      expect(ConfigKeys.HUGGINGFACE_API_KEY.envKey).toBe('HUGGINGFACE_API_KEY');
    });
  });
});
