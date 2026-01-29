import { createLogger } from '../config/logger.js';

const logger = createLogger('Tools');

/**
 * Tool parameter definition
 */
export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
}

/**
 * Tool definition interface
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/**
 * Result from executing a tool
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
  message?: string;
}

/**
 * Tool registry for managing custom tools
 */
export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  /**
   * Register a new tool
   */
  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      logger.warn('Overwriting existing tool', { name: tool.name });
    }
    this.tools.set(tool.name, tool);
    logger.info('Registered tool', { name: tool.name });
  }

  /**
   * Unregister a tool
   */
  unregister(name: string): boolean {
    const removed = this.tools.delete(name);
    if (removed) {
      logger.info('Unregistered tool', { name });
    }
    return removed;
  }

  /**
   * Get a tool by name
   */
  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool by name
   */
  async execute(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        success: false,
        error: `Unknown tool: ${name}`,
      };
    }

    // Validate required parameters
    for (const param of tool.parameters) {
      if (param.required && !(param.name in args)) {
        return {
          success: false,
          error: `Missing required parameter: ${param.name}`,
        };
      }
    }

    // Apply defaults
    const argsWithDefaults: Record<string, unknown> = { ...args };
    for (const param of tool.parameters) {
      if (!(param.name in argsWithDefaults) && param.default !== undefined) {
        argsWithDefaults[param.name] = param.default;
      }
    }

    try {
      logger.debug('Executing tool', { name, args: argsWithDefaults });
      const result = await tool.execute(argsWithDefaults);
      logger.debug('Tool execution completed', { name, success: result.success });
      return result;
    } catch (error) {
      logger.error('Tool execution failed', error, { name });
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get tool definitions in a format suitable for LLM function calling
   */
  getToolSchemas(): object[] {
    return Array.from(this.tools.values()).map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(
            tool.parameters.map((p) => [
              p.name,
              {
                type: p.type,
                description: p.description,
              },
            ])
          ),
          required: tool.parameters.filter((p) => p.required).map((p) => p.name),
        },
      },
    }));
  }
}

/**
 * Global tool registry instance
 */
export const toolRegistry = new ToolRegistry();
