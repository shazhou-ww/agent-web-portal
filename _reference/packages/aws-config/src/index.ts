import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

/**
 * Configuration source type
 */
export type ConfigSource = 'env' | 'secrets-manager' | 'parameter-store';

/**
 * Result of a config fetch operation
 */
export interface ConfigResult {
  value: string;
  source: ConfigSource;
}

/**
 * AWS Configuration Manager
 *
 * Reads configuration values with the following priority:
 * 1. Environment variables (highest priority)
 * 2. AWS Secrets Manager (for secrets like API keys)
 * 3. AWS SSM Parameter Store (for configuration values)
 *
 * This allows local development to use .env files while production
 * uses AWS services for secure configuration management.
 */
export class ConfigManager {
  private secretsClient: SecretsManagerClient | null = null;
  private ssmClient: SSMClient | null = null;
  private region: string;
  private cache: Map<string, ConfigResult> = new Map();
  private enableCaching: boolean;

  constructor(options?: { region?: string; enableCaching?: boolean }) {
    this.region = options?.region || process.env.AWS_REGION || 'us-east-1';
    this.enableCaching = options?.enableCaching ?? true;
  }

  /**
   * Lazy initialization of Secrets Manager client
   */
  private getSecretsClient(): SecretsManagerClient {
    if (!this.secretsClient) {
      this.secretsClient = new SecretsManagerClient({ region: this.region });
    }
    return this.secretsClient;
  }

  /**
   * Lazy initialization of SSM client
   */
  private getSSMClient(): SSMClient {
    if (!this.ssmClient) {
      this.ssmClient = new SSMClient({ region: this.region });
    }
    return this.ssmClient;
  }

  /**
   * Get a secret value from AWS Secrets Manager
   */
  async getSecret(secretId: string): Promise<string | null> {
    try {
      const command = new GetSecretValueCommand({ SecretId: secretId });
      const response = await this.getSecretsClient().send(command);
      return response.SecretString || null;
    } catch (error) {
      console.warn(`Failed to get secret ${secretId}:`, error);
      return null;
    }
  }

  /**
   * Get a parameter value from AWS SSM Parameter Store
   */
  async getParameter(name: string, withDecryption = true): Promise<string | null> {
    try {
      const command = new GetParameterCommand({
        Name: name,
        WithDecryption: withDecryption,
      });
      const response = await this.getSSMClient().send(command);
      return response.Parameter?.Value || null;
    } catch (error) {
      console.warn(`Failed to get parameter ${name}:`, error);
      return null;
    }
  }

  /**
   * Get a configuration value with fallback chain
   *
   * Priority: ENV -> Secrets Manager -> Parameter Store -> default
   *
   * @param envKey - Environment variable name
   * @param options - Optional configuration
   * @param options.secretId - AWS Secrets Manager secret ID
   * @param options.parameterId - AWS SSM Parameter Store parameter name
   * @param options.defaultValue - Default value if not found anywhere
   * @param options.required - Throw error if value not found (default: false)
   */
  async getConfig(
    envKey: string,
    options?: {
      secretId?: string;
      parameterId?: string;
      defaultValue?: string;
      required?: boolean;
    }
  ): Promise<ConfigResult> {
    const cacheKey = `${envKey}:${options?.secretId || ''}:${options?.parameterId || ''}`;

    // Check cache first
    if (this.enableCaching && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    // 1. Try environment variable first (highest priority)
    const envValue = process.env[envKey];
    if (envValue !== undefined && envValue !== '') {
      const result: ConfigResult = { value: envValue, source: 'env' };
      if (this.enableCaching) {
        this.cache.set(cacheKey, result);
      }
      return result;
    }

    // 2. Try Secrets Manager (for sensitive values like API keys)
    if (options?.secretId) {
      const secretValue = await this.getSecret(options.secretId);
      if (secretValue) {
        // Handle JSON secrets - try to extract by key
        try {
          const parsed = JSON.parse(secretValue);
          const value =
            typeof parsed === 'object' && parsed !== null
              ? parsed[envKey] || secretValue
              : secretValue;
          const result: ConfigResult = { value: String(value), source: 'secrets-manager' };
          if (this.enableCaching) {
            this.cache.set(cacheKey, result);
          }
          return result;
        } catch {
          // Not JSON, use as-is
          const result: ConfigResult = { value: secretValue, source: 'secrets-manager' };
          if (this.enableCaching) {
            this.cache.set(cacheKey, result);
          }
          return result;
        }
      }
    }

    // 3. Try Parameter Store (for configuration values)
    if (options?.parameterId) {
      const paramValue = await this.getParameter(options.parameterId);
      if (paramValue) {
        const result: ConfigResult = { value: paramValue, source: 'parameter-store' };
        if (this.enableCaching) {
          this.cache.set(cacheKey, result);
        }
        return result;
      }
    }

    // 4. Use default value
    if (options?.defaultValue !== undefined) {
      const result: ConfigResult = { value: options.defaultValue, source: 'env' };
      if (this.enableCaching) {
        this.cache.set(cacheKey, result);
      }
      return result;
    }

    // 5. Throw if required
    if (options?.required) {
      throw new Error(
        `Required configuration not found: ${envKey}. ` +
          `Checked: ENV[${envKey}]` +
          (options.secretId ? `, SecretsManager[${options.secretId}]` : '') +
          (options.parameterId ? `, ParameterStore[${options.parameterId}]` : '')
      );
    }

    throw new Error(`Configuration not found: ${envKey}`);
  }

  /**
   * Get a configuration value, returning just the string value
   * Convenience wrapper around getConfig
   */
  async getValue(
    envKey: string,
    options?: {
      secretId?: string;
      parameterId?: string;
      defaultValue?: string;
      required?: boolean;
    }
  ): Promise<string> {
    const result = await this.getConfig(envKey, options);
    return result.value;
  }

  /**
   * Clear the configuration cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// Singleton instance for convenience
let defaultInstance: ConfigManager | null = null;

/**
 * Get the default ConfigManager instance
 */
export function getConfigManager(options?: {
  region?: string;
  enableCaching?: boolean;
}): ConfigManager {
  if (!defaultInstance) {
    defaultInstance = new ConfigManager(options);
  }
  return defaultInstance;
}

/**
 * Convenience function to get a config value using the default instance
 */
export async function getConfig(
  envKey: string,
  options?: {
    secretId?: string;
    parameterId?: string;
    defaultValue?: string;
    required?: boolean;
  }
): Promise<ConfigResult> {
  return getConfigManager().getConfig(envKey, options);
}

/**
 * Convenience function to get a config value (string only) using the default instance
 */
export async function getValue(
  envKey: string,
  options?: {
    secretId?: string;
    parameterId?: string;
    defaultValue?: string;
    required?: boolean;
  }
): Promise<string> {
  return getConfigManager().getValue(envKey, options);
}

/**
 * Well-known configuration keys for the mitsein-ai project
 */
export const ConfigKeys = {
  // API Keys (Secrets)
  STABILITY_API_KEY: {
    envKey: 'STABILITY_API_KEY',
    secretId: 'mitsein-ai/stability-api-key',
  },
  HUGGINGFACE_API_KEY: {
    envKey: 'HUGGINGFACE_API_KEY',
    secretId: 'mitsein-ai/huggingface-api-key',
  },
  IMAGE_WORKSHOP_HMAC_SECRET: {
    envKey: 'IMAGE_WORKSHOP_HMAC_SECRET',
    secretId: 'mitsein-ai/image-workshop-hmac-secret',
  },

  // Endpoints (Parameters)
  SAGEMAKER_ENDPOINT_NAME: {
    envKey: 'SAGEMAKER_ENDPOINT_NAME',
    parameterId: '/mitsein-ai/sagemaker/endpoint-name',
  },
  SAGEMAKER_REGION: {
    envKey: 'SAGEMAKER_REGION',
    parameterId: '/mitsein-ai/sagemaker/region',
  },
} as const;

export type ConfigKeyName = keyof typeof ConfigKeys;

/**
 * Get a well-known configuration value
 */
export async function getKnownConfig(
  key: ConfigKeyName,
  options?: { required?: boolean }
): Promise<string> {
  const config = ConfigKeys[key];
  return getConfigManager().getValue(config.envKey, {
    secretId: 'secretId' in config ? config.secretId : undefined,
    parameterId: 'parameterId' in config ? config.parameterId : undefined,
    required: options?.required,
  });
}
