import { EventEmitter } from 'events';
import { WakewordDetector, SpeechToText, TextToSpeech, AzureSpeechConfig } from './speech/index.js';
import { CopilotClient, ConversationManager, ConversationMessage } from './agent/index.js';
import { registerSpeakerControl } from './tools/index.js';
import { AppConfig, createLogger, LogLevel } from './config/index.js';

const logger = createLogger('App');

/**
 * Application states
 */
export enum AppState {
  IDLE = 'IDLE',
  LISTENING_WAKEWORD = 'LISTENING_WAKEWORD',
  LISTENING_COMMAND = 'LISTENING_COMMAND',
  PROCESSING = 'PROCESSING',
  RESPONDING = 'RESPONDING',
  ERROR = 'ERROR',
}

/**
 * Events emitted by the application
 */
export interface AppEvents {
  stateChanged: (state: AppState, previousState: AppState) => void;
  wakewordDetected: () => void;
  speechRecognized: (text: string) => void;
  responseGenerated: (text: string) => void;
  error: (error: Error) => void;
}

/**
 * Configuration for the application
 */
export interface AppOptions {
  continuousConversation?: boolean;
  conversationTimeoutMs?: number;
  maxConversationTurns?: number;
}

/**
 * Main application orchestrator
 * Manages the voice assistant lifecycle and state machine
 */
export class App extends EventEmitter {
  private _config: AppConfig;
  private options: AppOptions;
  private state: AppState = AppState.IDLE;
  
  // Speech components
  private wakewordDetector: WakewordDetector;
  private stt: SpeechToText;
  private tts: TextToSpeech;
  
  // Agent components
  private copilotClient: CopilotClient;
  private conversationManager: ConversationManager;
  
  // State tracking
  private conversationTurns = 0;
  private isShuttingDown = false;
  private conversationTimeoutId: NodeJS.Timeout | null = null;

  constructor(config: AppConfig, options: AppOptions = {}) {
    super();
    this._config = config;
    this.options = {
      continuousConversation: options.continuousConversation ?? true,
      conversationTimeoutMs: options.conversationTimeoutMs ?? 30000,
      maxConversationTurns: options.maxConversationTurns ?? 10,
    };

    // Initialize Azure Speech components
    const azureConfig: AzureSpeechConfig = {
      subscriptionKey: config.azure.speechKey,
      region: config.azure.speechRegion,
      voiceName: config.azure.voiceName,
      keywordModelPath: config.keywordModelPath,
    };

    this.wakewordDetector = new WakewordDetector(azureConfig);
    this.stt = new SpeechToText(azureConfig);
    this.tts = new TextToSpeech(azureConfig);

    // Initialize Copilot client and conversation manager
    this.copilotClient = new CopilotClient({
      cliPath: config.copilot.cliPath,
      enableFileTools: true,
      enableWebTools: true,
    });

    this.conversationManager = new ConversationManager(this.copilotClient, {
      maxHistoryLength: 20,
      contextTimeout: this.options.conversationTimeoutMs,
    });

    // Set log levels
    this.setLogLevel(config.logLevel);

    // Register custom tools
    registerSpeakerControl();

    // Set up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up event handlers for speech components
   */
  private setupEventHandlers(): void {
    // Wakeword detection
    this.wakewordDetector.on('wakewordDetected', () => {
      logger.info('Wakeword detected');
      this.emit('wakewordDetected');
      this.transitionTo(AppState.LISTENING_COMMAND);
    });

    this.wakewordDetector.on('error', (error: Error) => {
      logger.error('Wakeword detector error', error);
      this.handleError(error);
    });

    // Speech recognition
    this.stt.on('speechRecognized', (text: string) => {
      if (text.trim()) {
        logger.info('Speech recognized', { text });
        this.emit('speechRecognized', text);
        void this.handleUserInput(text);
      }
    });

    this.stt.on('speechRecognizing', (text: string) => {
      logger.debug('Recognizing', { interim: text });
    });

    this.stt.on('error', (error: Error) => {
      logger.error('Speech recognition error', error);
      this.handleError(error);
    });
  }

  /**
   * Transition to a new state
   */
  private transitionTo(newState: AppState): void {
    const previousState = this.state;
    if (previousState === newState) return;

    this.state = newState;
    logger.info('State transition', { from: previousState, to: newState });
    this.emit('stateChanged', newState, previousState);

    // Handle state entry actions
    void this.onStateEntry(newState, previousState);
  }

  /**
   * Handle actions when entering a new state
   */
  private async onStateEntry(state: AppState, _previousState: AppState): Promise<void> {
    switch (state) {
      case AppState.LISTENING_WAKEWORD:
        await this.startWakewordDetection();
        break;

      case AppState.LISTENING_COMMAND:
        await this.stopWakewordDetection();
        await this.startSpeechRecognition();
        this.startConversationTimeout();
        break;

      case AppState.PROCESSING:
        await this.stopSpeechRecognition();
        this.clearConversationTimeout();
        break;

      case AppState.RESPONDING:
        // Speaking response - handled by handleUserInput
        break;

      case AppState.IDLE:
        await this.cleanup();
        break;

      case AppState.ERROR:
        await this.cleanup();
        // Attempt recovery after a delay
        setTimeout(() => {
          if (!this.isShuttingDown) {
            this.transitionTo(AppState.LISTENING_WAKEWORD);
          }
        }, 5000);
        break;
    }
  }

  /**
   * Start wakeword detection
   */
  private async startWakewordDetection(): Promise<void> {
    try {
      await this.wakewordDetector.start();
      logger.info('Listening for wakeword...');
    } catch (error) {
      logger.error('Failed to start wakeword detection', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Stop wakeword detection
   */
  private async stopWakewordDetection(): Promise<void> {
    try {
      await this.wakewordDetector.stop();
    } catch (error) {
      logger.error('Failed to stop wakeword detection', error);
    }
  }

  /**
   * Start speech recognition
   */
  private async startSpeechRecognition(): Promise<void> {
    try {
      await this.stt.startContinuousRecognition();
      logger.info('Listening for command...');
    } catch (error) {
      logger.error('Failed to start speech recognition', error);
      this.handleError(error as Error);
    }
  }

  /**
   * Stop speech recognition
   */
  private async stopSpeechRecognition(): Promise<void> {
    try {
      await this.stt.stopContinuousRecognition();
    } catch (error) {
      logger.error('Failed to stop speech recognition', error);
    }
  }

  /**
   * Handle user input from speech recognition
   */
  private async handleUserInput(text: string): Promise<void> {
    this.transitionTo(AppState.PROCESSING);
    this.conversationTurns++;

    try {
      // Send to Copilot and get response
      const response = await this.conversationManager.chat(text);
      
      // Speak the response
      this.transitionTo(AppState.RESPONDING);
      await this.speak(response);
      
      this.emit('responseGenerated', response);

      // Determine next state
      this.determineNextState();
    } catch (error) {
      logger.error('Failed to process user input', error);
      await this.speak("I'm sorry, I encountered an error processing your request.");
      this.handleError(error as Error);
    }
  }

  /**
   * Speak a response using TTS
   */
  private async speak(text: string): Promise<void> {
    try {
      // Use SSML for more natural speech
      const ssml = this.tts.createResponseSsml(text, 'friendly');
      await this.tts.speakSsml(ssml);
    } catch (error) {
      logger.error('TTS error, falling back to plain text', error);
      try {
        await this.tts.speak(text);
      } catch (fallbackError) {
        logger.error('TTS fallback also failed', fallbackError);
      }
    }
  }

  /**
   * Determine next state after responding
   */
  private determineNextState(): void {
    if (this.isShuttingDown) {
      this.transitionTo(AppState.IDLE);
      return;
    }

    // Check if we should continue the conversation
    const shouldContinue =
      this.options.continuousConversation &&
      this.conversationTurns < this.options.maxConversationTurns!;

    if (shouldContinue) {
      // Continue listening for more commands
      this.transitionTo(AppState.LISTENING_COMMAND);
    } else {
      // End conversation, go back to wakeword detection
      this.conversationManager.endSession();
      this.conversationTurns = 0;
      this.transitionTo(AppState.LISTENING_WAKEWORD);
    }
  }

  /**
   * Start conversation timeout
   */
  private startConversationTimeout(): void {
    this.clearConversationTimeout();
    this.conversationTimeoutId = setTimeout(() => {
      logger.info('Conversation timeout');
      this.conversationManager.endSession();
      this.conversationTurns = 0;
      this.transitionTo(AppState.LISTENING_WAKEWORD);
    }, this.options.conversationTimeoutMs);
  }

  /**
   * Clear conversation timeout
   */
  private clearConversationTimeout(): void {
    if (this.conversationTimeoutId) {
      clearTimeout(this.conversationTimeoutId);
      this.conversationTimeoutId = null;
    }
  }

  /**
   * Handle errors
   */
  private handleError(error: Error): void {
    this.emit('error', error);
    this.transitionTo(AppState.ERROR);
  }

  /**
   * Clean up all resources
   */
  private async cleanup(): Promise<void> {
    this.clearConversationTimeout();
    await this.stopWakewordDetection();
    await this.stopSpeechRecognition();
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    logger.info('Starting Copilot Smart Speaker');

    try {
      // Initialize Copilot client
      await this.copilotClient.initialize();
      
      // Start listening for wakeword
      this.transitionTo(AppState.LISTENING_WAKEWORD);
      
      logger.info('Application started successfully');
    } catch (error) {
      logger.error('Failed to start application', error);
      throw error;
    }
  }

  /**
   * Stop the application
   */
  async stop(): Promise<void> {
    logger.info('Stopping Copilot Smart Speaker');
    this.isShuttingDown = true;

    try {
      // Clean up speech components
      await this.cleanup();
      this.tts.close();
      
      // Clean up agent
      this.conversationManager.endSession();
      this.copilotClient.close();
      
      this.transitionTo(AppState.IDLE);
      logger.info('Application stopped successfully');
    } catch (error) {
      logger.error('Error during shutdown', error);
      throw error;
    }
  }

  /**
   * Get current application state
   */
  getState(): AppState {
    return this.state;
  }

  /**
   * Get application config
   */
  getConfig(): AppConfig {
    return this._config;
  }

  /**
   * Get conversation history
   */
  getConversationHistory(): ConversationMessage[] {
    return this.conversationManager.getHistory();
  }

  /**
   * Set log level for all components
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
    this.wakewordDetector.setLogLevel(level);
    this.stt.setLogLevel(level);
    this.copilotClient.setLogLevel(level);
    this.conversationManager.setLogLevel(level);
  }
}
