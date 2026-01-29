# Copilot for Smart Speaker

A desktop voice assistant application powered by GitHub Copilot and Azure Speech Services. This application listens for a wakeword, captures voice input, processes conversational requests through GitHub Copilot SDK with agentic capabilities (file operations, web search, custom tools), and responds with synthesized speech.

## Features

- **Wake Word Detection**: Configurable wake word using Azure Keyword Recognition
- **Speech-to-Text**: Real-time speech recognition with interim results
- **Copilot Integration**: Conversational AI powered by GitHub Copilot
- **Text-to-Speech**: Natural voice synthesis with SSML support
- **Continuous Conversation**: Context-aware multi-turn conversations
- **Custom Tools**: Extensible tool system for custom capabilities

## Prerequisites

- Node.js 18.0.0 or later
- Azure Speech Services subscription
- GitHub Copilot CLI installed and configured

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/benleane83/copilot-for-smart-speaker.git
   cd copilot-for-smart-speaker
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure environment variables:
   ```bash
   cp .env.example .env
   # Edit .env with your Azure Speech key and region
   ```

## Configuration

### Required Environment Variables

| Variable | Description |
|----------|-------------|
| `AZURE_SPEECH_KEY` | Azure Speech subscription key |
| `AZURE_SPEECH_REGION` | Azure Speech region (e.g., `eastus`) |

### Optional Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COPILOT_CLI_PATH` | `copilot` | Path to Copilot CLI |
| `KEYWORD_MODEL_PATH` | - | Path to custom keyword model (.table file) |
| `AZURE_VOICE_NAME` | `en-US-JennyNeural` | Azure TTS voice name |
| `LOG_LEVEL` | `info` | Log level: `debug`, `info`, `warn`, `error` |

## Usage

### Start the Application

```bash
npm start
```

### CLI Options

```bash
npm start -- --help              # Show help
npm start -- --verbose           # Enable debug logging
npm start -- --voice <name>      # Set TTS voice
npm start -- --keyword-model <path>  # Use custom keyword model
```

### Development Mode

```bash
npm run dev                      # Watch mode with auto-restart
```

## Project Structure

```
src/
├── index.ts              # Entry point and CLI
├── app.ts                # Main application orchestrator
├── config/
│   ├── config.ts         # Configuration loading
│   └── logger.ts         # Structured logging
├── speech/
│   └── azure-speech.ts   # Azure Speech SDK integration
├── agent/
│   ├── copilot-client.ts      # Copilot SDK client
│   └── conversation-manager.ts # Conversation state management
└── tools/
    ├── tool-registry.ts  # Tool registration system
    └── speaker-control.ts # Example custom tool
```

## State Machine

The application follows this state machine:

```
IDLE → LISTENING_WAKEWORD → LISTENING_COMMAND → PROCESSING → RESPONDING
                ↑                                                  │
                └──────────────────────────────────────────────────┘
                          (continuous conversation)
```

## Building

```bash
npm run build              # Compile TypeScript to dist/
```

## Testing

```bash
npm test                   # Run tests
npm run test:watch         # Watch mode
```

## Linting

```bash
npm run lint               # Run ESLint
```

## Creating Custom Tools

You can extend the assistant's capabilities by creating custom tools:

```typescript
import { ToolDefinition, toolRegistry } from './tools/tool-registry.js';

const myTool: ToolDefinition = {
  name: 'my_tool',
  description: 'Description of what the tool does',
  parameters: [
    {
      name: 'input',
      type: 'string',
      description: 'Input parameter',
      required: true,
    },
  ],
  execute: async (args) => {
    // Tool implementation
    return {
      success: true,
      data: { result: 'done' },
    };
  },
};

toolRegistry.register(myTool);
```

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **LLM/Agent**: GitHub Copilot SDK
- **Speech Services**: Azure Cognitive Services (Speech)
- **Features**: File operations, web search, custom tools

## License

MIT