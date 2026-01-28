import { ToolRegistry, ToolDefinition, ToolResult } from './tool-registry.js';

describe('ToolRegistry', () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  const createMockTool = (name: string): ToolDefinition => ({
    name,
    description: `Mock tool ${name}`,
    parameters: [
      {
        name: 'input',
        type: 'string',
        description: 'Input parameter',
        required: true,
      },
      {
        name: 'optional',
        type: 'number',
        description: 'Optional parameter',
        required: false,
        default: 42,
      },
    ],
    execute: jest.fn().mockResolvedValue({
      success: true,
      data: { result: `executed ${name}` },
    } as ToolResult),
  });

  describe('register', () => {
    it('should register a tool', () => {
      const tool = createMockTool('test');
      registry.register(tool);
      expect(registry.get('test')).toBe(tool);
    });

    it('should overwrite existing tool with same name', () => {
      const tool1 = createMockTool('test');
      const tool2 = createMockTool('test');
      registry.register(tool1);
      registry.register(tool2);
      expect(registry.get('test')).toBe(tool2);
    });
  });

  describe('unregister', () => {
    it('should unregister a tool', () => {
      const tool = createMockTool('test');
      registry.register(tool);
      expect(registry.unregister('test')).toBe(true);
      expect(registry.get('test')).toBeUndefined();
    });

    it('should return false for non-existent tool', () => {
      expect(registry.unregister('nonexistent')).toBe(false);
    });
  });

  describe('getAll', () => {
    it('should return all registered tools', () => {
      const tool1 = createMockTool('tool1');
      const tool2 = createMockTool('tool2');
      registry.register(tool1);
      registry.register(tool2);
      const tools = registry.getAll();
      expect(tools).toHaveLength(2);
      expect(tools).toContain(tool1);
      expect(tools).toContain(tool2);
    });
  });

  describe('execute', () => {
    it('should execute a tool with valid arguments', async () => {
      const tool = createMockTool('test');
      registry.register(tool);
      const result = await registry.execute('test', { input: 'hello' });
      expect(result.success).toBe(true);
      expect(tool.execute).toHaveBeenCalledWith({ input: 'hello', optional: 42 });
    });

    it('should return error for unknown tool', async () => {
      const result = await registry.execute('unknown', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });

    it('should return error for missing required parameter', async () => {
      const tool = createMockTool('test');
      registry.register(tool);
      const result = await registry.execute('test', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required parameter');
    });

    it('should apply default values for optional parameters', async () => {
      const tool = createMockTool('test');
      registry.register(tool);
      await registry.execute('test', { input: 'hello' });
      expect(tool.execute).toHaveBeenCalledWith({ input: 'hello', optional: 42 });
    });

    it('should handle tool execution errors', async () => {
      const tool = createMockTool('test');
      (tool.execute as jest.Mock).mockRejectedValue(new Error('Execution failed'));
      registry.register(tool);
      const result = await registry.execute('test', { input: 'hello' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Execution failed');
    });
  });

  describe('getToolSchemas', () => {
    it('should return tool schemas in function calling format', () => {
      const tool = createMockTool('test');
      registry.register(tool);
      const schemas = registry.getToolSchemas();
      expect(schemas).toHaveLength(1);
      expect(schemas[0]).toEqual({
        type: 'function',
        function: {
          name: 'test',
          description: 'Mock tool test',
          parameters: {
            type: 'object',
            properties: {
              input: {
                type: 'string',
                description: 'Input parameter',
              },
              optional: {
                type: 'number',
                description: 'Optional parameter',
              },
            },
            required: ['input'],
          },
        },
      });
    });
  });
});
