import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { createLogger, LogLevel } from '../config/logger.js';

const logger = createLogger('CopilotClient');

/**
 * Configuration for Copilot client
 */
export interface CopilotClientConfig {
  cliPath?: string;
  enableFileTools?: boolean;
  enableWebTools?: boolean;
  customToolsDir?: string;
}

/**
 * Response from Copilot agent
 */
export interface CopilotResponse {
  text: string;
  toolCalls?: ToolCall[];
  error?: string;
}

/**
 * Tool call made by the agent
 */
export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result?: string;
}

/**
 * Events emitted by the Copilot client
 */
export interface CopilotClientEvents {
  response: (response: CopilotResponse) => void;
  streaming: (chunk: string) => void;
  toolCall: (tool: ToolCall) => void;
  error: (error: Error) => void;
}

/**
 * Client for interacting with GitHub Copilot via CLI or SDK
 * This implementation uses a process-based approach for flexibility
 */
export class CopilotClient extends EventEmitter {
  private config: CopilotClientConfig;
  private process: ChildProcess | null = null;
  private isInitialized = false;

  constructor(config: CopilotClientConfig = {}) {
    super();
    this.config = {
      cliPath: config.cliPath || 'copilot',
      enableFileTools: config.enableFileTools ?? true,
      enableWebTools: config.enableWebTools ?? true,
      customToolsDir: config.customToolsDir,
    };
  }

  /**
   * Initialize the Copilot client
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      logger.warn('Client already initialized');
      return;
    }

    // Verify Copilot CLI is available
    try {
      await this.checkCopilotAvailable();
      this.isInitialized = true;
      logger.info('Copilot client initialized', {
        enableFileTools: this.config.enableFileTools,
        enableWebTools: this.config.enableWebTools,
      });
    } catch (error) {
      logger.error('Failed to initialize Copilot client', error);
      throw error;
    }
  }

  /**
   * Check if Copilot CLI is available
   */
  private async checkCopilotAvailable(): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn(this.config.cliPath!, ['--version'], {
        shell: true,
        timeout: 5000,
      });

      let output = '';
      let errorOutput = '';

      proc.stdout?.on('data', (data: Buffer) => {
        output += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        errorOutput += data.toString();
      });

      proc.on('close', (code) => {
        if (code === 0) {
          logger.debug('Copilot CLI version', { version: output.trim() });
          resolve();
        } else {
          reject(
            new Error(
              `Copilot CLI not available. Please install it first. Error: ${errorOutput || output}`
            )
          );
        }
      });

      proc.on('error', (error) => {
        reject(
          new Error(
            `Failed to check Copilot CLI: ${error.message}. ` +
              'Make sure GitHub Copilot CLI is installed and accessible.'
          )
        );
      });
    });
  }

  /**
   * Send a message to Copilot and get a response
   * Uses the conversational API pattern
   */
  async sendMessage(
    message: string,
    context?: { conversationHistory?: string[]; systemPrompt?: string }
  ): Promise<CopilotResponse> {
    if (!this.isInitialized) {
      await this.initialize();
    }

    logger.debug('Sending message to Copilot', { messageLength: message.length });

    return new Promise((resolve, reject) => {
      const args = ['chat'];

      // Add the message
      args.push('-m', message);

      // Add system prompt if provided
      if (context?.systemPrompt) {
        args.push('-s', context.systemPrompt);
      }

      // Enable tools based on configuration
      if (this.config.enableFileTools) {
        args.push('--enable-file-tools');
      }
      if (this.config.enableWebTools) {
        args.push('--enable-web-tools');
      }
      if (this.config.customToolsDir) {
        args.push('--tools-dir', this.config.customToolsDir);
      }

      this.process = spawn(this.config.cliPath!, args, {
        shell: true,
        timeout: 60000, // 60 second timeout
      });

      let stdout = '';
      let stderr = '';

      this.process.stdout?.on('data', (data: Buffer) => {
        const chunk = data.toString();
        stdout += chunk;
        this.emit('streaming', chunk);
      });

      this.process.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.process.on('close', (code) => {
        this.process = null;

        if (code === 0) {
          const response = this.parseResponse(stdout);
          logger.info('Received response from Copilot', {
            responseLength: response.text.length,
            hasToolCalls: (response.toolCalls?.length ?? 0) > 0,
          });
          resolve(response);
        } else {
          const error = new Error(`Copilot returned error code ${code}: ${stderr || stdout}`);
          logger.error('Copilot error', error);
          resolve({
            text: this.getFallbackResponse(message, stderr),
            error: stderr,
          });
        }
      });

      this.process.on('error', (error) => {
        this.process = null;
        logger.error('Copilot process error', error);
        reject(error);
      });
    });
  }

  /**
   * Parse the raw output from Copilot into a structured response
   */
  private parseResponse(output: string): CopilotResponse {
    // Remove ANSI escape codes
    // eslint-disable-next-line no-control-regex
    const cleanOutput = output.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '').trim();

    // Try to extract tool calls if present
    const toolCalls: ToolCall[] = [];
    const toolCallRegex = /\[Tool: (\w+)\]\s*({[\s\S]*?})\s*\[Result: ([\s\S]*?)\]/g;
    let match;

    while ((match = toolCallRegex.exec(cleanOutput)) !== null) {
      try {
        toolCalls.push({
          name: match[1],
          arguments: JSON.parse(match[2]) as Record<string, unknown>,
          result: match[3],
        });
      } catch {
        // Skip malformed tool calls
      }
    }

    // Extract main response text (everything except tool call artifacts)
    const responseText = cleanOutput
      .replace(toolCallRegex, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    return {
      text: responseText || 'I processed your request.',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    };
  }

  /**
   * Generate a fallback response when Copilot fails
   */
  private getFallbackResponse(message: string, error: string): string {
    if (error.includes('rate limit')) {
      return "I'm currently experiencing high demand. Please try again in a moment.";
    }
    if (error.includes('authentication') || error.includes('unauthorized')) {
      return 'There seems to be an authentication issue. Please check your Copilot subscription.';
    }
    if (error.includes('timeout')) {
      return 'The request took too long. Please try a simpler question.';
    }
    return `I encountered an issue processing your request: "${message.substring(0, 50)}...". Please try again.`;
  }

  /**
   * Cancel any ongoing request
   */
  cancel(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
      this.process = null;
      logger.info('Cancelled ongoing Copilot request');
    }
  }

  /**
   * Close the client and cleanup resources
   */
  close(): void {
    this.cancel();
    this.isInitialized = false;
    logger.info('Copilot client closed');
  }

  /**
   * Check if client is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}
