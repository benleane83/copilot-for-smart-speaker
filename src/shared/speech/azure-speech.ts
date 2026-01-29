// Access the Azure Speech SDK from the global window object
// It's loaded via CDN script tag in index.html
declare global {
  interface Window {
    SpeechSDK: any;
  }
}

// In browser context (renderer), use the global SDK
// In Node.js context (main process), this won't be used
const sdk = typeof window !== 'undefined' ? window.SpeechSDK : {} as any;

import { EventEmitter } from '../events.js';
import { createLogger, LogLevel } from '../config/logger.js';

const logger = createLogger('AzureSpeech');

/**
 * Events emitted by speech components
 */
export interface SpeechEvents {
  wakewordDetected: () => void;
  speechRecognized: (text: string) => void;
  speechRecognizing: (text: string) => void;
  sessionStarted: () => void;
  sessionStopped: () => void;
  canceled: (reason: string) => void;
  error: (error: Error) => void;
}

/**
 * Configuration for Azure Speech services
 */
export interface AzureSpeechConfig {
  subscriptionKey: string;
  region: string;
  voiceName?: string;
  keywordModelPath?: string | null;
}

/**
 * Wakeword detector using Azure Keyword Recognition
 */
export class WakewordDetector extends EventEmitter {
  private config: any;
  private audioConfig: any | null = null;
  private recognizer: any | null = null;
  private keywordModel: any | null = null;
  private isListening = false;

  constructor(azureConfig: AzureSpeechConfig) {
    super();
    this.config = sdk.SpeechConfig.fromSubscription(
      azureConfig.subscriptionKey,
      azureConfig.region
    );

    if (azureConfig.keywordModelPath) {
      this.keywordModel = sdk.KeywordRecognitionModel.fromFile(azureConfig.keywordModelPath);
      logger.info('Loaded custom keyword model', { path: azureConfig.keywordModelPath });
    }
  }

  /**
   * Start listening for wakeword
   */
  async start(): Promise<void> {
    if (this.isListening) {
      logger.warn('Wakeword detector already listening');
      return;
    }

    this.audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    this.recognizer = new sdk.SpeechRecognizer(this.config, this.audioConfig);

    this.recognizer.recognizing = (_sender, event) => {
      if (!this.keywordModel && event.result.reason === sdk.ResultReason.RecognizingSpeech) {
        this.emit('speechRecognizing', event.result.text);
      }
    };

    this.recognizer.recognized = (_sender, event) => {
      if (this.keywordModel && event.result.reason === sdk.ResultReason.RecognizedKeyword) {
        logger.info('Wakeword detected');
        this.emit('wakewordDetected');
        return;
      }

      if (!this.keywordModel && event.result.reason === sdk.ResultReason.RecognizedSpeech) {
        if (event.result.text && event.result.text.trim().length > 0) {
          logger.info('Speech detected (no keyword model)');
          this.emit('wakewordDetected');
        }
      }
    };

    this.recognizer.canceled = (_sender, event) => {
      logger.warn('Wakeword recognition canceled', { reason: sdk.CancellationReason[event.reason] });
      this.emit('canceled', sdk.CancellationReason[event.reason]);
    };

    this.recognizer.sessionStarted = () => {
      logger.debug('Wakeword session started');
      this.emit('sessionStarted');
    };

    this.recognizer.sessionStopped = () => {
      logger.debug('Wakeword session stopped');
      this.emit('sessionStopped');
    };

    return new Promise((resolve, reject) => {
      if (!this.recognizer) {
        reject(new Error('Recognizer not initialized'));
        return;
      }

      if (this.keywordModel) {
        this.recognizer.startKeywordRecognitionAsync(
          this.keywordModel,
          () => {
            this.isListening = true;
            logger.info('Started keyword recognition');
            resolve();
          },
          (error) => {
            logger.error('Failed to start keyword recognition', error);
            reject(new Error(error));
          }
        );
      } else {
        // Without a keyword model, use continuous recognition
        // and treat any speech as a "wake" trigger
        logger.info('No keyword model configured, using continuous recognition');
        this.recognizer.startContinuousRecognitionAsync(
          () => {
            this.isListening = true;
            resolve();
          },
          (error) => {
            logger.error('Failed to start continuous recognition', error);
            reject(new Error(error));
          }
        );
      }
    });
  }

  /**
   * Stop listening for wakeword
   */
  async stop(): Promise<void> {
    if (!this.isListening || !this.recognizer) {
      return;
    }

    return new Promise((resolve, reject) => {
      const stopFn = this.keywordModel
        ? this.recognizer!.stopKeywordRecognitionAsync.bind(this.recognizer)
        : this.recognizer!.stopContinuousRecognitionAsync.bind(this.recognizer);

      stopFn(
        () => {
          this.isListening = false;
          this.cleanup();
          logger.info('Stopped wakeword detection');
          resolve();
        },
        (error) => {
          logger.error('Failed to stop wakeword detection', error);
          reject(new Error(error));
        }
      );
    });
  }

  private cleanup(): void {
    if (this.recognizer) {
      this.recognizer.close();
      this.recognizer = null;
    }
    this.audioConfig = null;
  }

  /**
   * Check if detector is currently listening
   */
  getIsListening(): boolean {
    return this.isListening;
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}

/**
 * Speech-to-Text recognizer with continuous recognition support
 */
export class SpeechToText extends EventEmitter {
  private config: any;
  private audioConfig: any | null = null;
  private recognizer: any | null = null;
  private isRecognizing = false;

  constructor(azureConfig: AzureSpeechConfig) {
    super();
    this.config = sdk.SpeechConfig.fromSubscription(
      azureConfig.subscriptionKey,
      azureConfig.region
    );
    // Configure for conversational speech
    this.config.setProperty(
      sdk.PropertyId.SpeechServiceConnection_EndSilenceTimeoutMs,
      '1500'
    );
  }

  /**
   * Start continuous speech recognition
   */
  async startContinuousRecognition(): Promise<void> {
    if (this.isRecognizing) {
      logger.warn('Already recognizing');
      return;
    }

    this.audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    this.recognizer = new sdk.SpeechRecognizer(this.config, this.audioConfig);

    // Interim results (while speaking)
    this.recognizer.recognizing = (_sender, event) => {
      if (event.result.reason === sdk.ResultReason.RecognizingSpeech) {
        this.emit('speechRecognizing', event.result.text);
      }
    };

    // Final recognized text
    this.recognizer.recognized = (_sender, event) => {
      if (event.result.reason === sdk.ResultReason.RecognizedSpeech) {
        logger.info('Speech recognized', { text: event.result.text });
        this.emit('speechRecognized', event.result.text);
      } else if (event.result.reason === sdk.ResultReason.NoMatch) {
        logger.debug('No speech recognized');
      }
    };

    this.recognizer.canceled = (_sender, event) => {
      if (event.reason === sdk.CancellationReason.Error) {
        logger.error('Speech recognition error', new Error(event.errorDetails));
        this.emit('error', new Error(event.errorDetails));
      } else {
        logger.debug('Speech recognition canceled', { reason: sdk.CancellationReason[event.reason] });
      }
      this.emit('canceled', sdk.CancellationReason[event.reason]);
    };

    this.recognizer.sessionStarted = () => {
      logger.debug('STT session started');
      this.emit('sessionStarted');
    };

    this.recognizer.sessionStopped = () => {
      logger.debug('STT session stopped');
      this.emit('sessionStopped');
    };

    return new Promise((resolve, reject) => {
      this.recognizer!.startContinuousRecognitionAsync(
        () => {
          this.isRecognizing = true;
          logger.info('Started continuous speech recognition');
          resolve();
        },
        (error) => {
          logger.error('Failed to start speech recognition', error);
          reject(new Error(error));
        }
      );
    });
  }

  /**
   * Perform single-shot recognition (recognize once then stop)
   */
  async recognizeOnce(): Promise<string> {
    this.audioConfig = sdk.AudioConfig.fromDefaultMicrophoneInput();
    this.recognizer = new sdk.SpeechRecognizer(this.config, this.audioConfig);

    return new Promise((resolve, reject) => {
      this.recognizer!.recognizeOnceAsync(
        (result) => {
          this.cleanup();
          if (result.reason === sdk.ResultReason.RecognizedSpeech) {
            logger.info('Speech recognized (once)', { text: result.text });
            resolve(result.text);
          } else if (result.reason === sdk.ResultReason.NoMatch) {
            logger.debug('No speech recognized');
            resolve('');
          } else {
            const errorMessage = sdk.ResultReason[result.reason];
            logger.error('Speech recognition failed', new Error(errorMessage));
            reject(new Error(`Recognition failed: ${errorMessage}`));
          }
        },
        (error) => {
          this.cleanup();
          logger.error('Speech recognition error', error);
          reject(new Error(error));
        }
      );
    });
  }

  /**
   * Stop continuous recognition
   */
  async stopContinuousRecognition(): Promise<void> {
    if (!this.isRecognizing || !this.recognizer) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.recognizer!.stopContinuousRecognitionAsync(
        () => {
          this.isRecognizing = false;
          this.cleanup();
          logger.info('Stopped continuous speech recognition');
          resolve();
        },
        (error) => {
          logger.error('Failed to stop speech recognition', error);
          reject(new Error(error));
        }
      );
    });
  }

  private cleanup(): void {
    if (this.recognizer) {
      this.recognizer.close();
      this.recognizer = null;
    }
    this.audioConfig = null;
  }

  /**
   * Check if currently recognizing
   */
  getIsRecognizing(): boolean {
    return this.isRecognizing;
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}

/**
 * Text-to-Speech synthesizer with SSML support
 */
export class TextToSpeech extends EventEmitter {
  private config: any;
  private audioConfig: any | null = null;
  private synthesizer: any | null = null;
  private voiceName: string;

  constructor(azureConfig: AzureSpeechConfig) {
    super();
    this.config = sdk.SpeechConfig.fromSubscription(
      azureConfig.subscriptionKey,
      azureConfig.region
    );
    this.voiceName = azureConfig.voiceName || 'en-US-JennyNeural';
    this.config.speechSynthesisVoiceName = this.voiceName;
  }

  /**
   * Initialize the synthesizer
   */
  private initSynthesizer(): void {
    if (!this.synthesizer) {
      this.audioConfig = sdk.AudioConfig.fromDefaultSpeakerOutput();
      this.synthesizer = new sdk.SpeechSynthesizer(this.config, this.audioConfig);
    }
  }

  /**
   * Synthesize text to speech
   */
  async speak(text: string): Promise<void> {
    this.initSynthesizer();

    return new Promise((resolve, reject) => {
      this.synthesizer!.speakTextAsync(
        text,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            logger.info('Speech synthesis completed', { textLength: text.length });
            resolve();
          } else {
            const errorMessage = sdk.ResultReason[result.reason];
            logger.error('Speech synthesis failed', new Error(errorMessage));
            reject(new Error(`Synthesis failed: ${errorMessage}`));
          }
        },
        (error) => {
          logger.error('Speech synthesis error', error);
          reject(new Error(error));
        }
      );
    });
  }

  /**
   * Synthesize SSML to speech for more natural responses
   */
  async speakSsml(ssml: string): Promise<void> {
    this.initSynthesizer();

    return new Promise((resolve, reject) => {
      this.synthesizer!.speakSsmlAsync(
        ssml,
        (result) => {
          if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
            logger.info('SSML synthesis completed');
            resolve();
          } else {
            const errorMessage = sdk.ResultReason[result.reason];
            logger.error('SSML synthesis failed', new Error(errorMessage));
            reject(new Error(`SSML synthesis failed: ${errorMessage}`));
          }
        },
        (error) => {
          logger.error('SSML synthesis error', error);
          reject(new Error(error));
        }
      );
    });
  }

  /**
   * Create SSML for a response with appropriate prosody
   */
  createResponseSsml(text: string, style: 'friendly' | 'neutral' | 'excited' = 'friendly'): string {
    const styleMap: Record<string, string> = {
      friendly: 'chat',
      neutral: 'newscast-casual',
      excited: 'cheerful',
    };

    return `
      <speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" 
             xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="en-US">
        <voice name="${this.voiceName}">
          <mstts:express-as style="${styleMap[style]}">
            ${this.escapeXml(text)}
          </mstts:express-as>
        </voice>
      </speak>
    `.trim();
  }

  private escapeXml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  /**
   * Stop current speech synthesis
   */
  stop(): void {
    if (this.synthesizer) {
      try {
        // Stop synthesis immediately
        this.synthesizer.close();
        this.synthesizer = null;
        this.audioConfig = null;
        logger.info('TTS synthesis stopped');
      } catch (error) {
        logger.error('Error stopping TTS', error);
      }
    }
  }

  /**
   * Clean up synthesizer resources
   */
  close(): void {
    if (this.synthesizer) {
      this.synthesizer.close();
      this.synthesizer = null;
    }
    this.audioConfig = null;
    logger.debug('TTS resources cleaned up');
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}
