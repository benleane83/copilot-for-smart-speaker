import { loadConfig, resetConfig } from './config.js';

describe('Config', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    resetConfig();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('loadConfig', () => {
    it('should load config with required environment variables', () => {
      process.env['AZURE_SPEECH_KEY'] = 'test-key';
      process.env['AZURE_SPEECH_REGION'] = 'eastus';

      const config = loadConfig();

      expect(config.azure.speechKey).toBe('test-key');
      expect(config.azure.speechRegion).toBe('eastus');
    });

    it('should throw error when required variables are missing', () => {
      delete process.env['AZURE_SPEECH_KEY'];
      delete process.env['AZURE_SPEECH_REGION'];

      expect(() => loadConfig()).toThrow('Missing required environment variables');
    });

    it('should use default values for optional variables', () => {
      process.env['AZURE_SPEECH_KEY'] = 'test-key';
      process.env['AZURE_SPEECH_REGION'] = 'eastus';

      const config = loadConfig();

      expect(config.azure.voiceName).toBe('en-US-JennyNeural');
      expect(config.copilot.cliPath).toBe('copilot');
      expect(config.logLevel).toBe('info');
      expect(config.keywordModelPath).toBeNull();
    });

    it('should use environment values for optional variables when provided', () => {
      process.env['AZURE_SPEECH_KEY'] = 'test-key';
      process.env['AZURE_SPEECH_REGION'] = 'eastus';
      process.env['AZURE_VOICE_NAME'] = 'en-GB-SoniaNeural';
      process.env['COPILOT_CLI_PATH'] = '/custom/path/copilot';
      process.env['LOG_LEVEL'] = 'debug';
      process.env['KEYWORD_MODEL_PATH'] = '/path/to/model.table';

      const config = loadConfig();

      expect(config.azure.voiceName).toBe('en-GB-SoniaNeural');
      expect(config.copilot.cliPath).toBe('/custom/path/copilot');
      expect(config.logLevel).toBe('debug');
      expect(config.keywordModelPath).toBe('/path/to/model.table');
    });

    it('should throw error for invalid log level', () => {
      process.env['AZURE_SPEECH_KEY'] = 'test-key';
      process.env['AZURE_SPEECH_REGION'] = 'eastus';
      process.env['LOG_LEVEL'] = 'invalid';

      expect(() => loadConfig()).toThrow('Invalid LOG_LEVEL');
    });
  });
});
