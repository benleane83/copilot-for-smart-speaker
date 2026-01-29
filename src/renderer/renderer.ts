import { WakewordDetector, SpeechToText, TextToSpeech, AzureSpeechConfig } from '../shared/speech/index.js';

// DOM elements
const statusEl = document.getElementById('status')!;
const waveformEl = document.getElementById('waveform')!;
const transcriptArea = document.getElementById('transcript-area')!;
const errorEl = document.getElementById('error')!;
const stopButton = document.getElementById('stop-button')!;

// Speech components
let wakewordDetector: WakewordDetector | null = null;
let stt: SpeechToText | null = null;
let tts: TextToSpeech | null = null;
let hasKeywordModel = false;

// Application state
let isListeningForWakeword = false;
let isListeningForCommand = false;
let conversationActive = false;
let isSpeaking = false;
let isProcessing = false;

/**
 * Wait for the Azure Speech SDK to load from CDN
 */
function waitForSpeechSDK(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.SpeechSDK) {
      console.log('Azure Speech SDK already loaded');
      resolve();
      return;
    }
    
    let attempts = 0;
    const maxAttempts = 100; // 10 seconds total
    
    // Poll every 100ms until SDK is available
    const checkInterval = setInterval(() => {
      attempts++;
      
      if (window.SpeechSDK) {
        console.log('Azure Speech SDK loaded successfully');
        clearInterval(checkInterval);
        resolve();
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        const error = 'Azure Speech SDK failed to load from CDN after 10 seconds';
        console.error(error);
        reject(new Error(error));
      }
    }, 100);
  });
}

/**
 * Append a message to the transcript area
 * Only keeps the latest user message and assistant response
 */
function addMessage(text: string, type: 'user' | 'assistant'): void {
  const messageEl = document.createElement('div');
  messageEl.className = `message ${type}`;
  
  const labelEl = document.createElement('div');
  labelEl.className = 'message-label';
  labelEl.textContent = type === 'user' ? 'You' : 'Copilot';
  
  const textEl = document.createElement('div');
  textEl.textContent = text;
  
  messageEl.appendChild(labelEl);
  messageEl.appendChild(textEl);
  transcriptArea.appendChild(messageEl);
  
  // Keep only the latest 2 messages (1 user + 1 assistant)
  const messages = transcriptArea.querySelectorAll('.message');
  if (messages.length > 2) {
    // Remove oldest messages, keeping only the last 2
    for (let i = 0; i < messages.length - 2; i++) {
      messages[i].remove();
    }
  }
  
  // Scroll to bottom
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

/**
 * Show error message
 */
function showError(message: string): void {
  errorEl.textContent = `Error: ${message}`;
  errorEl.style.display = 'block';
  setTimeout(() => {
    errorEl.style.display = 'none';
  }, 5000);
}

/**
 * Show or hide the stop button
 */
function setStopButtonVisible(visible: boolean): void {
  if (visible) {
    stopButton.classList.add('visible');
  } else {
    stopButton.classList.remove('visible');
  }
}

/**
 * Stop current operation (TTS or processing)
 */
async function stopCurrentOperation(): Promise<void> {
  console.log('Stop button pressed');
  
  // Prevent concurrent stop operations
  const wasProcessing = isProcessing;
  const wasSpeaking = isSpeaking;
  const wasListening = isListeningForCommand;
  
  // Reset state immediately
  isProcessing = false;
  isSpeaking = false;
  setStopButtonVisible(false);
  
  // Cancel Copilot request if processing
  if (wasProcessing) {
    window.electronAPI.cancelCopilot();
  }
  
  // Stop TTS if speaking
  if (wasSpeaking && tts) {
    tts.stop();
  }
  
  // Stop speech recognition if listening
  if (wasListening && stt) {
    await stt.stopContinuousRecognition();
    isListeningForCommand = false;
  }
  
  // Go back to wakeword detection
  await startWakewordDetection();
}

/**
 * Update UI status
 */
function updateStatus(message: string, listening: boolean = false, detecting: boolean = false): void {
  statusEl.textContent = message;
  waveformEl.classList.toggle('listening', listening);
  waveformEl.classList.toggle('detecting', detecting);
}

/**
 * Initialize speech components
 */
async function initializeSpeech(): Promise<void> {
  try {
    // Wait for Azure Speech SDK to load from CDN
    await waitForSpeechSDK();
    
    // Get config from main process
    const config = await window.electronAPI.getConfig();
    
    const azureConfig: AzureSpeechConfig = {
      subscriptionKey: config.azure.speechKey,
      region: config.azure.speechRegion,
      voiceName: config.azure.voiceName,
      keywordModelPath: config.keywordModelPath,
    };

    hasKeywordModel = Boolean(config.keywordModelPath);

    // Initialize components
    wakewordDetector = new WakewordDetector(azureConfig);
    stt = new SpeechToText(azureConfig);
    tts = new TextToSpeech(azureConfig);

    // Set up event handlers
    wakewordDetector.on('wakewordDetected', onWakewordDetected);
    wakewordDetector.on('speechRecognizing', (text: string) => {
      updateStatus(`Listening (mic): "${text}..."`, true, true);
    });
    wakewordDetector.on('sessionStarted', () => {
      if (!isListeningForCommand) {
        const status = hasKeywordModel
          ? 'Listening for wakeword... (mic active)'
          : 'Listening for speech... (mic active)';
        updateStatus(status, true, true);
      }
    });
    wakewordDetector.on('sessionStopped', () => {
      if (!isListeningForCommand) {
        const status = hasKeywordModel
          ? 'Listening for wakeword...'
          : 'Listening for speech...';
        updateStatus(status, true, false);
      }
    });
    wakewordDetector.on('error', (error: Error) => {
      console.error('Wakeword error:', error);
      showError(error.message);
    });

    stt.on('speechRecognized', onSpeechRecognized);
    stt.on('speechRecognizing', (text: string) => {
      // If voice is detected while speaking, interrupt TTS
      // Only interrupt if we have substantial input to avoid false positives from noise
      if (isSpeaking && text.trim().length > 3) {
        console.log('Voice detected during TTS, interrupting...');
        if (tts) {
          tts.stop();
          isSpeaking = false;
        }
      }
      updateStatus(`Listening: "${text}..."`, true, true);
    });
    stt.on('error', (error: Error) => {
      console.error('Speech recognition error:', error);
      showError(error.message);
    });

    console.log('Speech components initialized');
  } catch (error) {
    console.error('Failed to initialize speech:', error);
    showError((error as Error).message);
  }
}

/**
 * Start listening for wakeword
 */
async function startWakewordDetection(): Promise<void> {
  if (!wakewordDetector || isListeningForWakeword) return;
  
  try {
    await wakewordDetector.start();
    isListeningForWakeword = true;
    const status = hasKeywordModel
      ? 'Listening for wakeword...'
      : 'Listening for speech...';
    updateStatus(status, true);
    console.log('Started wakeword detection');
  } catch (error) {
    console.error('Failed to start wakeword detection:', error);
    showError((error as Error).message);
  }
}

/**
 * Handle wakeword detected
 */
async function onWakewordDetected(): Promise<void> {
  console.log('Wakeword detected!');
  updateStatus('Wakeword detected! Speak now...', true);
  
  // Stop wakeword detection
  if (wakewordDetector) {
    await wakewordDetector.stop();
    isListeningForWakeword = false;
  }
  
  // Start speech recognition
  await startSpeechRecognition();
}

/**
 * Start continuous speech recognition
 */
async function startSpeechRecognition(): Promise<void> {
  if (!stt || isListeningForCommand) return;
  
  try {
    await stt.startContinuousRecognition();
    isListeningForCommand = true;
    conversationActive = true;
    setStopButtonVisible(true);
    updateStatus('Listening for your command...', true);
    console.log('Started speech recognition');
  } catch (error) {
    console.error('Failed to start speech recognition:', error);
    showError((error as Error).message);
  }
}

/**
 * Handle speech recognized
 */
async function onSpeechRecognized(text: string): Promise<void> {
  if (!text.trim()) return;
  
  console.log('Speech recognized:', text);
  addMessage(text, 'user');
  
  // Stop listening
  if (stt) {
    await stt.stopContinuousRecognition();
    isListeningForCommand = false;
  }
  
  isProcessing = true;
  setStopButtonVisible(true);
  updateStatus('Processing with Copilot...', false);
  
  // Send to main process for Copilot processing
  window.electronAPI.sendUserSpeech(text);
}

/**
 * Handle Copilot response
 */
async function onCopilotResponse(response: string): Promise<void> {
  console.log('Copilot response:', response);
  addMessage(response, 'assistant');
  
  isProcessing = false;
  
  // Speak the response
  isSpeaking = true;
  setStopButtonVisible(true);
  updateStatus('Speaking response...', false);
  
  try {
    if (tts) {
      const ssml = tts.createResponseSsml(response, 'friendly');
      await tts.speakSsml(ssml);
    }
    
    isSpeaking = false;
    setStopButtonVisible(false);
    // If conversation is still active, keep listening
    if (conversationActive) {
      await startSpeechRecognition();
    } else {
      await startWakewordDetection();
    }
  } catch (error) {
    console.error('TTS error:', error);
    // Only show error if it's not a user-initiated stop
    if (!(error as Error).message.includes('stopped')) {
      showError((error as Error).message);
    }
    isSpeaking = false;
    setStopButtonVisible(false);
    await startWakewordDetection();
  }
}

/**
 * Initialize the application
 */
async function initialize(): Promise<void> {
  updateStatus('Initializing speech services...', false);
  
  // Initialize speech components
  await initializeSpeech();
  
  // Wait for Copilot to be ready
  updateStatus('Waiting for Copilot...', false);
}

/**
 * Set up IPC listeners
 */
window.electronAPI.onCopilotReady(() => {
  console.log('Copilot ready!');
  updateStatus('Ready! Say the wakeword...', false);
  startWakewordDetection();
});

window.electronAPI.onCopilotResponse((response: string) => {
  onCopilotResponse(response);
});

window.electronAPI.onCopilotError((error: string) => {
  console.error('Copilot error:', error);
  showError(error);
  // Clean up all state on error
  isProcessing = false;
  isSpeaking = false;
  isListeningForCommand = false;
  setStopButtonVisible(false);
  startWakewordDetection();
});

window.electronAPI.onConversationEnded(() => {
  console.log('Conversation ended');
  conversationActive = false;
  setStopButtonVisible(false);
  startWakewordDetection();
});

// Set up stop button listener
stopButton.addEventListener('click', () => {
  stopCurrentOperation();
});

// Start the application
initialize();
