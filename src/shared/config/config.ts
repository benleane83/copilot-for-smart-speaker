import { config as dotenvConfig } from 'dotenv';

// Load environment variables from .env file
dotenvConfig();

/**
 * Application configuration loaded from environment variables
 */
export interface AppConfig {
  azure: {
    speechKey: string;
    speechRegion: string;
    voiceName: string;
  };
  copilot: {
    cliPath: string;
  };
  keywordModelPath: string | null;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Validates that required environment variables are present
 */
function validateEnv(): void {
  const required = ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION'];
  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Please copy .env.example to .env and fill in the values.'
    );
  }
}

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): AppConfig {
  validateEnv();

  const logLevel = (process.env['LOG_LEVEL'] || 'info') as AppConfig['logLevel'];
  if (!['debug', 'info', 'warn', 'error'].includes(logLevel)) {
    throw new Error(`Invalid LOG_LEVEL: ${logLevel}. Must be one of: debug, info, warn, error`);
  }

  return {
    azure: {
      speechKey: process.env['AZURE_SPEECH_KEY']!,
      speechRegion: process.env['AZURE_SPEECH_REGION']!,
      voiceName: process.env['AZURE_VOICE_NAME'] || 'en-US-JennyNeural',
    },
    copilot: {
      cliPath: process.env['COPILOT_CLI_PATH'] || 'copilot',
    },
    keywordModelPath: process.env['KEYWORD_MODEL_PATH'] || null,
    logLevel,
  };
}

/**
 * Singleton config instance
 */
let configInstance: AppConfig | null = null;

/**
 * Get the application configuration (singleton)
 */
export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset config for testing purposes
 */
export function resetConfig(): void {
  configInstance = null;
}
