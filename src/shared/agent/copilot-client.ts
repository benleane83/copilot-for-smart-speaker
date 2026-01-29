import { CopilotClient as SdkCopilotClient, CopilotSession, type AssistantMessageEvent, type SessionConfig, type SessionEvent } from '@github/copilot-sdk';
import { EventEmitter } from '../events.js';
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
 * Client for interacting with GitHub Copilot via the SDK
 * This implementation uses a process-based approach for flexibility
 */
export class CopilotClient extends EventEmitter {
  private config: CopilotClientConfig;
  private sdkClient: SdkCopilotClient | null = null;
  private session: CopilotSession | null = null;
  private sessionSystemPrompt: string | null = null;
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

    try {
      await this.ensureClient();
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

    let fullPrompt = message;

    const { session, created } = await this.ensureSession(context?.systemPrompt);
    if (created && context?.conversationHistory && context.conversationHistory.length > 0) {
      fullPrompt = `${context.conversationHistory.join('\n')}\nUser: ${message}`;
    }
    const toolCalls: ToolCall[] = [];
    const toolCallArgs = new Map<string, { name: string; arguments: Record<string, unknown> }>();

    const unsubscribe = session.on((event: SessionEvent) => {
      if (event.type === 'assistant.message_delta') {
        this.emit('streaming', event.data.deltaContent);
        return;
      }

      if (event.type === 'tool.execution_start') {
        toolCallArgs.set(event.data.toolCallId, {
          name: event.data.toolName,
          arguments: this.normalizeToolArguments(event.data.arguments),
        });
        return;
      }

      if (event.type === 'tool.execution_complete') {
        const args = toolCallArgs.get(event.data.toolCallId);
        toolCalls.push({
          name: args?.name ?? event.data.toolCallId,
          arguments: args?.arguments ?? {},
          result: event.data.result?.content ?? event.data.error?.message,
        });
        return;
      }

      if (event.type === 'session.error') {
        this.emit('error', new Error(event.data.message));
      }
    });

    try {
      const responseEvent: AssistantMessageEvent | undefined = await session.sendAndWait(
        { prompt: fullPrompt },
        60000
      );

      const responseText = responseEvent?.data.content?.trim() ?? '';
      const response: CopilotResponse = {
        text: responseText || 'I processed your request.',
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      };

      logger.info('Received response from Copilot', {
        responseLength: response.text.length,
        hasToolCalls: (response.toolCalls?.length ?? 0) > 0,
      });

      this.emit('response', response);
      return response;
    } catch (error) {
      logger.error('Copilot error', error);
      return {
        text: this.getFallbackResponse(message, (error as Error).message),
        error: (error as Error).message,
      };
    } finally {
      unsubscribe();
    }
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
    if (this.session) {
      void this.session.abort();
      logger.info('Cancelled ongoing Copilot request');
    }
  }

  /**
   * End the active session
   */
  async endSession(): Promise<void> {
    if (!this.session) return;

    const session = this.session;
    this.session = null;
    this.sessionSystemPrompt = null;
    await session.destroy();
    logger.info('Copilot session destroyed');
  }

  /**
   * Close the client and cleanup resources
   */
  close(): void {
    this.cancel();
    void this.stopSdkClient().catch((error) => {
      logger.error('Failed to stop Copilot client', error);
    });
  }

  /**
   * Check if client is initialized
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  private async ensureClient(): Promise<void> {
    if (this.sdkClient) return;

    this.sdkClient = new SdkCopilotClient({
      cliPath: this.config.cliPath,
    });

    await this.sdkClient.start();

    const authStatus = await this.sdkClient.getAuthStatus();
    if (!authStatus.isAuthenticated) {
      throw new Error(authStatus.statusMessage ?? 'Copilot authentication required.');
    }
  }

  private async ensureSession(systemPrompt?: string): Promise<{ session: CopilotSession; created: boolean }> {
    const normalizedSystemPrompt = systemPrompt ?? null;

    if (this.session) {
      if (this.sessionSystemPrompt === normalizedSystemPrompt) {
        return { session: this.session, created: false };
      }

      await this.session.destroy();
      this.session = null;
      this.sessionSystemPrompt = null;
    }

    if (!this.sdkClient) {
      await this.ensureClient();
    }

    this.sessionSystemPrompt = normalizedSystemPrompt;
    this.session = await this.sdkClient!.createSession(this.buildSessionConfig(systemPrompt));
    return { session: this.session, created: true };
  }

  private buildSessionConfig(systemPrompt?: string): SessionConfig {
    const sessionConfig: SessionConfig = {
      streaming: true,
      tools: [],
      availableTools: [],
    };

    if (systemPrompt) {
      sessionConfig.systemMessage = { content: systemPrompt };
    }

    if (this.config.enableFileTools || this.config.enableWebTools) {
      sessionConfig.availableTools = undefined;
    }

    return sessionConfig;
  }

  private async stopSdkClient(): Promise<void> {
    await this.endSession();

    if (this.sdkClient) {
      const errors = await this.sdkClient.stop();
      if (errors.length > 0) {
        logger.warn('Copilot client stopped with errors', { errors });
      }
      this.sdkClient = null;
    }

    this.isInitialized = false;
    logger.info('Copilot client closed');
  }

  private normalizeToolArguments(value: unknown): Record<string, unknown> {
    if (typeof value === 'object' && value !== null) {
      return value as Record<string, unknown>;
    }

    return {};
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}
