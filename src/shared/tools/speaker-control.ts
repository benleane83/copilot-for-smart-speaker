import { exec } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition, ToolResult, toolRegistry } from './tool-registry.js';
import { createLogger } from '../config/logger.js';

const execAsync = promisify(exec);
const logger = createLogger('SpeakerControl');

/**
 * Speaker control tool for managing audio playback and volume
 * Note: Commands are platform-specific (currently supports macOS and Linux)
 */

/**
 * Get the current volume level
 */
async function getVolume(): Promise<number> {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      // macOS
      const { stdout } = await execAsync(
        'osascript -e "output volume of (get volume settings)"'
      );
      return parseInt(stdout.trim(), 10);
    } else if (platform === 'linux') {
      // Linux with PulseAudio
      const { stdout } = await execAsync(
        "pactl get-sink-volume @DEFAULT_SINK@ | grep -Po '[0-9]+(?=%)' | head -1"
      );
      return parseInt(stdout.trim(), 10);
    } else if (platform === 'win32') {
      // Windows - requires nircmd or similar
      logger.warn('Volume control not fully implemented for Windows');
      return 50; // Default fallback
    }
  } catch (error) {
    logger.error('Failed to get volume', error);
  }

  return 50; // Default fallback
}

/**
 * Set the volume level
 */
async function setVolume(level: number): Promise<boolean> {
  const platform = process.platform;
  const clampedLevel = Math.max(0, Math.min(100, level));

  try {
    if (platform === 'darwin') {
      await execAsync(`osascript -e "set volume output volume ${clampedLevel}"`);
      return true;
    } else if (platform === 'linux') {
      await execAsync(`pactl set-sink-volume @DEFAULT_SINK@ ${clampedLevel}%`);
      return true;
    } else if (platform === 'win32') {
      logger.warn('Volume control not fully implemented for Windows');
      return false;
    }
  } catch (error) {
    logger.error('Failed to set volume', error);
  }

  return false;
}

/**
 * Mute or unmute the speaker
 */
async function setMute(muted: boolean): Promise<boolean> {
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      await execAsync(
        `osascript -e "set volume output muted ${muted}"`
      );
      return true;
    } else if (platform === 'linux') {
      await execAsync(
        `pactl set-sink-mute @DEFAULT_SINK@ ${muted ? 1 : 0}`
      );
      return true;
    } else if (platform === 'win32') {
      logger.warn('Mute control not fully implemented for Windows');
      return false;
    }
  } catch (error) {
    logger.error('Failed to set mute', error);
  }

  return false;
}

/**
 * Speaker control tool definition
 */
export const speakerControlTool: ToolDefinition = {
  name: 'speaker_control',
  description:
    'Control the speaker volume and mute state. Can get/set volume level (0-100) and mute/unmute.',
  parameters: [
    {
      name: 'action',
      type: 'string',
      description: 'The action to perform: "get_volume", "set_volume", "mute", "unmute"',
      required: true,
    },
    {
      name: 'level',
      type: 'number',
      description: 'Volume level (0-100), required for set_volume action',
      required: false,
    },
  ],
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const action = args['action'] as string;

    switch (action) {
      case 'get_volume': {
        const volume = await getVolume();
        return {
          success: true,
          data: { volume },
          message: `Current volume is ${volume}%`,
        };
      }

      case 'set_volume': {
        const level = args['level'] as number;
        if (typeof level !== 'number') {
          return {
            success: false,
            error: 'Volume level is required for set_volume action',
          };
        }
        const success = await setVolume(level);
        return {
          success,
          message: success
            ? `Volume set to ${Math.max(0, Math.min(100, level))}%`
            : 'Failed to set volume',
        };
      }

      case 'mute': {
        const success = await setMute(true);
        return {
          success,
          message: success ? 'Speaker muted' : 'Failed to mute speaker',
        };
      }

      case 'unmute': {
        const success = await setMute(false);
        return {
          success,
          message: success ? 'Speaker unmuted' : 'Failed to unmute speaker',
        };
      }

      default:
        return {
          success: false,
          error: `Unknown action: ${action}. Valid actions: get_volume, set_volume, mute, unmute`,
        };
    }
  },
};

/**
 * Register the speaker control tool
 */
export function registerSpeakerControl(): void {
  toolRegistry.register(speakerControlTool);
  logger.info('Speaker control tool registered');
}
