/**
 * AWS Configuration
 *
 * Utilities for fetching configuration from SSM Parameter Store and Secrets Manager
 */

import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

// ============================================================================
// Clients
// ============================================================================

let ssmClient: SSMClient | null = null;
let secretsClient: SecretsManagerClient | null = null;

function getSSMClient(): SSMClient {
  if (!ssmClient) {
    ssmClient = new SSMClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return ssmClient;
}

function getSecretsClient(): SecretsManagerClient {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });
  }
  return secretsClient;
}

// ============================================================================
// Config Fetching
// ============================================================================

/**
 * Known configuration keys and their sources
 */
const CONFIG_SOURCES: Record<string, { type: 'env' | 'ssm' | 'secret'; name: string }> = {
  STABILITY_API_KEY: { type: 'secret', name: 'awp-image-workshop/stability-api-key' },
  BFL_API_KEY: { type: 'secret', name: 'awp-image-workshop/bfl-api-key' },
  IMAGE_WORKSHOP_HMAC_SECRET: { type: 'secret', name: 'awp-image-workshop/hmac-secret' },
};

/**
 * Get a known configuration value
 *
 * @param key - Configuration key
 * @param options - Options
 * @returns Configuration value
 */
export async function getKnownConfig(
  key: string,
  options: { required?: boolean } = {}
): Promise<string> {
  // First check environment variables (for local development)
  const envValue = process.env[key];
  if (envValue) {
    return envValue;
  }

  // Get from configured source
  const source = CONFIG_SOURCES[key];
  if (!source) {
    if (options.required) {
      throw new Error(`Unknown configuration key: ${key}`);
    }
    return '';
  }

  try {
    if (source.type === 'secret') {
      return await getSecretValue(source.name);
    }
    if (source.type === 'ssm') {
      return await getSSMParameter(source.name);
    }
    return '';
  } catch (error) {
    if (options.required) {
      throw new Error(`Failed to get required config ${key}: ${error}`);
    }
    return '';
  }
}

/**
 * Get a value from Secrets Manager
 */
async function getSecretValue(secretName: string): Promise<string> {
  const client = getSecretsClient();
  const command = new GetSecretValueCommand({ SecretId: secretName });
  const response = await client.send(command);

  if (response.SecretString) {
    return response.SecretString;
  }

  throw new Error(`Secret ${secretName} has no string value`);
}

/**
 * Get a value from SSM Parameter Store
 */
async function getSSMParameter(parameterName: string): Promise<string> {
  const client = getSSMClient();
  const command = new GetParameterCommand({
    Name: parameterName,
    WithDecryption: true,
  });
  const response = await client.send(command);

  if (response.Parameter?.Value) {
    return response.Parameter.Value;
  }

  throw new Error(`SSM parameter ${parameterName} not found`);
}
