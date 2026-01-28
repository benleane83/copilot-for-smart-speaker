#!/usr/bin/env node

import { App, AppState } from './app.js';
import { loadConfig, AppConfig, createLogger } from './config/index.js';

const logger = createLogger('Main');

/**
 * Parse command line arguments
 */
function parseArgs(): {
  verbose: boolean;
  voice: string | undefined;
  keywordModel: string | undefined;
  help: boolean;
} {
  const args = process.argv.slice(2);
  const result = {
    verbose: false,
    voice: undefined as string | undefined,
    keywordModel: undefined as string | undefined,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    switch (arg) {
      case '-v':
      case '--verbose':
        result.verbose = true;
        break;

      case '--voice':
        result.voice = args[++i];
        break;

      case '--keyword-model':
        result.keywordModel = args[++i];
        break;

      case '-h':
      case '--help':
        result.help = true;
        break;

      default:
        if (arg.startsWith('-')) {
          logger.warn('Unknown argument', { arg });
        }
    }
  }

  return result;
}

/**
 * Print help message
 */
function printHelp(): void {
  console.log(`
Copilot for Smart Speaker
=========================

A voice assistant powered by GitHub Copilot and Azure Speech Services.

Usage: npm start [options]

Options:
  -v, --verbose        Enable debug logging
  --voice <name>       Azure Speech voice name (default: en-US-JennyNeural)
  --keyword-model <path>  Path to custom keyword model file (.table)
  -h, --help           Show this help message

Environment Variables (required):
  AZURE_SPEECH_KEY     Azure Speech subscription key
  AZURE_SPEECH_REGION  Azure Speech region (e.g., eastus)

Environment Variables (optional):
  COPILOT_CLI_PATH     Path to Copilot CLI (default: copilot)
  KEYWORD_MODEL_PATH   Path to keyword model (overridden by --keyword-model)
  AZURE_VOICE_NAME     Voice name (overridden by --voice)
  LOG_LEVEL            Log level: debug, info, warn, error (default: info)

Examples:
  npm start
  npm start --verbose
  npm start --voice en-GB-SoniaNeural
  npm start --keyword-model ./models/hey-copilot.table
`);
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    printHelp();
    process.exit(0);
  }

  // Load configuration
  let config: AppConfig;
  try {
    config = loadConfig();
  } catch (error) {
    logger.error('Configuration error', error);
    console.error(
      '\nError: Missing configuration. Please copy .env.example to .env and fill in the values.\n'
    );
    process.exit(1);
  }

  // Apply CLI overrides
  if (args.verbose) {
    config.logLevel = 'debug';
  }
  if (args.voice) {
    config.azure.voiceName = args.voice;
  }
  if (args.keywordModel) {
    config.keywordModelPath = args.keywordModel;
  }

  // Create and start the application
  const app = new App(config);

  // Handle process signals for graceful shutdown
  const shutdown = async (signal: string): Promise<void> => {
    logger.info('Received shutdown signal', { signal });
    try {
      await app.stop();
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', error);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', error);
    void shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', reason as Error);
  });

  // Log state changes
  app.on('stateChanged', (state: AppState, previousState: AppState) => {
    logger.debug('State changed', { from: previousState, to: state });
  });

  app.on('wakewordDetected', () => {
    console.log('\n🎤 Wakeword detected! Listening for command...\n');
  });

  app.on('speechRecognized', (text: string) => {
    console.log(`📝 You said: "${text}"\n`);
  });

  app.on('responseGenerated', (text: string) => {
    console.log(`🤖 Copilot: ${text}\n`);
  });

  app.on('error', (error: Error) => {
    console.error(`❌ Error: ${error.message}\n`);
  });

  // Start the application
  try {
    console.log('\n🚀 Starting Copilot Smart Speaker...\n');
    await app.start();
    console.log('✅ Ready! Say the wakeword to start a conversation.\n');
    console.log('Press Ctrl+C to exit.\n');
  } catch (error) {
    logger.error('Failed to start application', error);
    console.error(`\n❌ Failed to start: ${(error as Error).message}\n`);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
