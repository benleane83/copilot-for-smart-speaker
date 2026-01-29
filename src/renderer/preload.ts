import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload script that exposes safe IPC methods to the renderer
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Send user speech to main process
  sendUserSpeech: (text: string) => ipcRenderer.send('user-speech', text),
  
  // End the current conversation
  endConversation: () => ipcRenderer.send('end-conversation'),
  
  // Get conversation history
  getConversationHistory: () => ipcRenderer.invoke('get-conversation-history'),
  
  // Get config from main process
  getConfig: () => ipcRenderer.invoke('get-config'),
  
  // Listen for Copilot responses
  onCopilotResponse: (callback: (response: string) => void) => {
    ipcRenderer.on('copilot-response', (_event, response) => callback(response));
  },
  
  // Listen for Copilot ready event
  onCopilotReady: (callback: () => void) => {
    ipcRenderer.on('copilot-ready', () => callback());
  },
  
  // Listen for Copilot errors
  onCopilotError: (callback: (error: string) => void) => {
    ipcRenderer.on('copilot-error', (_event, error) => callback(error));
  },
  
  // Listen for conversation ended event
  onConversationEnded: (callback: () => void) => {
    ipcRenderer.on('conversation-ended', () => callback());
  },
});

// Type declarations for the window object
declare global {
  interface Window {
    electronAPI: {
      sendUserSpeech: (text: string) => void;
      endConversation: () => void;
      getConversationHistory: () => Promise<any[]>;
      getConfig: () => Promise<any>;
      onCopilotResponse: (callback: (response: string) => void) => void;
      onCopilotReady: (callback: () => void) => void;
      onCopilotError: (callback: (error: string) => void) => void;
      onConversationEnded: (callback: () => void) => void;
    };
  }
}
