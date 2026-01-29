import { createLogger, LogLevel } from '../config/logger.js';
import { CopilotClient } from './copilot-client.js';

const logger = createLogger('ConversationManager');

/**
 * A message in the conversation
 */
export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: { name: string; result?: string }[];
}

/**
 * Conversation session state
 */
export interface ConversationSession {
  id: string;
  startedAt: Date;
  messages: ConversationMessage[];
  context: Record<string, unknown>;
}

/**
 * Configuration for conversation manager
 */
export interface ConversationManagerConfig {
  maxHistoryLength?: number;
  systemPrompt?: string;
  contextTimeout?: number; // ms before context is considered stale
}

/**
 * Manages conversation state, history, and context across turns
 */
export class ConversationManager {
  private client: CopilotClient;
  private config: ConversationManagerConfig;
  private currentSession: ConversationSession | null = null;
  private contextTimeoutId: NodeJS.Timeout | null = null;

  constructor(client: CopilotClient, config: ConversationManagerConfig = {}) {
    this.client = client;
    this.config = {
      maxHistoryLength: config.maxHistoryLength ?? 20,
      systemPrompt:
        config.systemPrompt ??
        'You are a helpful voice assistant. Keep responses concise and conversational. ' +
          'When asked to perform actions like file operations or web searches, use the available tools.',
      contextTimeout: config.contextTimeout ?? 5 * 60 * 1000, // 5 minutes default
    };
  }

  /**
   * Start a new conversation session
   */
  startSession(): ConversationSession {
    this.endSession(); // Clean up any existing session

    this.currentSession = {
      id: this.generateSessionId(),
      startedAt: new Date(),
      messages: [],
      context: {},
    };

    logger.info('Started new conversation session', { sessionId: this.currentSession.id });
    this.resetContextTimeout();

    return this.currentSession;
  }

  /**
   * End the current conversation session
   */
  endSession(): void {
    if (this.currentSession) {
      logger.info('Ended conversation session', {
        sessionId: this.currentSession.id,
        messageCount: this.currentSession.messages.length,
      });
      this.currentSession = null;
    }

    void this.client.endSession();

    if (this.contextTimeoutId) {
      clearTimeout(this.contextTimeoutId);
      this.contextTimeoutId = null;
    }
  }

  /**
   * Send a message and get a response, maintaining conversation context
   */
  async chat(userMessage: string): Promise<string> {
    // Start a session if none exists
    if (!this.currentSession) {
      this.startSession();
    }

    this.resetContextTimeout();

    // Add user message to history
    this.addMessage({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    // Build conversation context for the agent
    const conversationHistory = this.buildConversationHistory();

    try {
      // Send to Copilot with context
      const response = await this.client.sendMessage(userMessage, {
        conversationHistory,
        systemPrompt: this.config.systemPrompt,
      });

      // Add assistant response to history
      this.addMessage({
        role: 'assistant',
        content: response.text,
        timestamp: new Date(),
        toolCalls: response.toolCalls?.map((tc) => ({
          name: tc.name,
          result: tc.result,
        })),
      });

      logger.debug('Chat turn completed', {
        sessionId: this.currentSession!.id,
        messageCount: this.currentSession!.messages.length,
      });

      return response.text;
    } catch (error) {
      logger.error('Chat error', error);
      throw error;
    }
  }

  /**
   * Get a streaming response (emits chunks as they arrive)
   */
  async *chatStream(userMessage: string): AsyncGenerator<string, void, unknown> {
    if (!this.currentSession) {
      this.startSession();
    }

    this.resetContextTimeout();

    this.addMessage({
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
    });

    const conversationHistory = this.buildConversationHistory();

    // Set up streaming listener
    const chunks: string[] = [];
    let resolveChunk: ((value: string | null) => void) | null = null;

    const handleChunk = (chunk: string): void => {
      if (resolveChunk) {
        resolveChunk(chunk);
        resolveChunk = null;
      } else {
        chunks.push(chunk);
      }
    };

    this.client.on('streaming', handleChunk);

    try {
      // Start the request (don't await completion)
      const responsePromise = this.client.sendMessage(userMessage, {
        conversationHistory,
        systemPrompt: this.config.systemPrompt,
      });

      // Yield chunks as they arrive
      while (true) {
        if (chunks.length > 0) {
          yield chunks.shift()!;
        } else {
          const chunk = await new Promise<string | null>((resolve) => {
            resolveChunk = resolve;
            // Check if response is already complete
            void responsePromise.then(() => {
              if (resolveChunk) {
                resolveChunk(null);
              }
            });
          });

          if (chunk === null) break;
          yield chunk;
        }
      }

      // Wait for full response to get tool calls etc
      const response = await responsePromise;

      this.addMessage({
        role: 'assistant',
        content: response.text,
        timestamp: new Date(),
        toolCalls: response.toolCalls?.map((tc) => ({
          name: tc.name,
          result: tc.result,
        })),
      });
    } finally {
      this.client.removeListener('streaming', handleChunk);
    }
  }

  /**
   * Add context information that persists across the conversation
   */
  setContext(key: string, value: unknown): void {
    if (this.currentSession) {
      this.currentSession.context[key] = value;
      logger.debug('Set conversation context', { key });
    }
  }

  /**
   * Get context value
   */
  getContext(key: string): unknown {
    return this.currentSession?.context[key];
  }

  /**
   * Get conversation history
   */
  getHistory(): ConversationMessage[] {
    return this.currentSession?.messages ?? [];
  }

  /**
   * Get current session info
   */
  getSession(): ConversationSession | null {
    return this.currentSession;
  }

  private addMessage(message: ConversationMessage): void {
    if (!this.currentSession) return;

    this.currentSession.messages.push(message);

    // Trim history if too long (keep system message if present, plus recent messages)
    const maxHistory = this.config.maxHistoryLength!;
    if (this.currentSession.messages.length > maxHistory) {
      const toRemove = this.currentSession.messages.length - maxHistory;
      this.currentSession.messages.splice(0, toRemove);
      logger.debug('Trimmed conversation history', { removed: toRemove });
    }
  }

  private buildConversationHistory(): string[] {
    if (!this.currentSession) return [];

    return this.currentSession.messages.slice(0, -1).map((msg) => {
      const prefix = msg.role === 'user' ? 'User' : 'Assistant';
      return `${prefix}: ${msg.content}`;
    });
  }

  private resetContextTimeout(): void {
    if (this.contextTimeoutId) {
      clearTimeout(this.contextTimeoutId);
    }

    this.contextTimeoutId = setTimeout(() => {
      logger.info('Conversation context timed out');
      this.endSession();
    }, this.config.contextTimeout);
  }

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Set log level for the module
   */
  setLogLevel(level: LogLevel): void {
    logger.setLevel(level);
  }
}
