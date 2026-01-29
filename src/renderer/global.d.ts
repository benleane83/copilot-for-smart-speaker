// Type declarations for Electron API exposed via preload

interface ElectronAPI {
  sendUserSpeech: (text: string) => void;
  endConversation: () => void;
  getConversationHistory: () => Promise<any[]>;
  getConfig: () => Promise<{
    azure: {
      speechKey: string;
      speechRegion: string;
      voiceName: string;
    };
    keywordModelPath: string | null;
  }>;
  onCopilotResponse: (callback: (response: string) => void) => void;
  onCopilotReady: (callback: () => void) => void;
  onCopilotError: (callback: (error: string) => void) => void;
  onConversationEnded: (callback: () => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
    SpeechSDK: any;
  }
}

export {};
