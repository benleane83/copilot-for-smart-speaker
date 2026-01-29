import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import { CopilotClient, ConversationManager } from '../shared/agent/index.js';
import { loadConfig, createLogger } from '../shared/config/index.js';
import { registerSpeakerControl } from '../shared/tools/index.js';

const logger = createLogger('Main');

let mainWindow: BrowserWindow | null = null;
let copilotClient: CopilotClient | null = null;
let conversationManager: ConversationManager | null = null;

/**
 * Create the main application window
 */
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(app.getAppPath(), 'dist/renderer/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    title: 'Copilot Smart Speaker',
    backgroundColor: '#1e1e1e',
  });

  // Load the renderer HTML file
  const rendererPath = path.join(app.getAppPath(), 'dist/renderer/index.html');
  mainWindow.loadFile(rendererPath);

  // Open DevTools in development
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  logger.info('Main window created');
}

/**
 * Initialize Copilot client
 */
async function initializeCopilot(): Promise<void> {
  try {
    const config = loadConfig();
    
    // Initialize Copilot client
    copilotClient = new CopilotClient({
      cliPath: config.copilot.cliPath,
      enableFileTools: false,
      enableWebTools: false,
    });

    conversationManager = new ConversationManager(copilotClient, {
      maxHistoryLength: 20,
      contextTimeout: 30000,
    });

    // Register custom tools
    registerSpeakerControl();

    await copilotClient.initialize();
    logger.info('Copilot client initialized');
    
    // Notify renderer that Copilot is ready
    mainWindow?.webContents.send('copilot-ready');
  } catch (error) {
    logger.error('Failed to initialize Copilot', error);
    mainWindow?.webContents.send('copilot-error', (error as Error).message);
  }
}

/**
 * Handle IPC messages from renderer
 */
function setupIpcHandlers(): void {
  // Handle user speech input from renderer
  ipcMain.on('user-speech', async (_event, text: string) => {
    logger.info('Received user speech', { text });
    
    try {
      if (!conversationManager) {
        throw new Error('Conversation manager not initialized');
      }

      // Send to Copilot and get response
      const response = await conversationManager.chat(text);
      
      logger.info('Copilot response', { responseLength: response.length });
      
      // Send response back to renderer for TTS
      mainWindow?.webContents.send('copilot-response', response);
    } catch (error) {
      logger.error('Failed to process user speech', error);
      mainWindow?.webContents.send('copilot-error', (error as Error).message);
    }
  });

  // Handle request to end conversation
  ipcMain.on('end-conversation', () => {
    logger.info('Ending conversation');
    conversationManager?.endSession();
    mainWindow?.webContents.send('conversation-ended');
  });

  // Handle request for conversation history
  ipcMain.handle('get-conversation-history', () => {
    return conversationManager?.getHistory() || [];
  });

  // Handle request for config
  ipcMain.handle('get-config', () => {
    const config = loadConfig();
    return {
      azure: {
        speechKey: config.azure.speechKey,
        speechRegion: config.azure.speechRegion,
        voiceName: config.azure.voiceName,
      },
      keywordModelPath: config.keywordModelPath,
    };
  });

  logger.info('IPC handlers registered');
}

/**
 * App lifecycle handlers
 */
app.whenReady().then(async () => {
  logger.info('Electron app ready');
  
  createWindow();
  setupIpcHandlers();
  await initializeCopilot();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  logger.info('App quitting, cleaning up...');
  conversationManager?.endSession();
  copilotClient?.close();
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception in main process', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection in main process', reason as Error);
});
