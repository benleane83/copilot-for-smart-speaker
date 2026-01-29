import { Logger, createLogger } from './logger.js';

describe('Logger', () => {
  let consoleSpy: {
    debug: jest.SpyInstance;
    info: jest.SpyInstance;
    warn: jest.SpyInstance;
    error: jest.SpyInstance;
  };

  beforeEach(() => {
    consoleSpy = {
      debug: jest.spyOn(console, 'debug').mockImplementation(),
      info: jest.spyOn(console, 'info').mockImplementation(),
      warn: jest.spyOn(console, 'warn').mockImplementation(),
      error: jest.spyOn(console, 'error').mockImplementation(),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should log debug messages when level is debug', () => {
      const logger = new Logger('Test', 'debug');
      logger.debug('test message');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });

    it('should not log debug messages when level is info', () => {
      const logger = new Logger('Test', 'info');
      logger.debug('test message');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
    });

    it('should log info messages when level is info', () => {
      const logger = new Logger('Test', 'info');
      logger.info('test message');
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('should not log info messages when level is warn', () => {
      const logger = new Logger('Test', 'warn');
      logger.info('test message');
      expect(consoleSpy.info).not.toHaveBeenCalled();
    });

    it('should log warn messages when level is warn', () => {
      const logger = new Logger('Test', 'warn');
      logger.warn('test message');
      expect(consoleSpy.warn).toHaveBeenCalled();
    });

    it('should log error messages when level is error', () => {
      const logger = new Logger('Test', 'error');
      logger.error('test message');
      expect(consoleSpy.error).toHaveBeenCalled();
    });
  });

  describe('message formatting', () => {
    it('should include timestamp, level, and context in messages', () => {
      const logger = new Logger('TestContext', 'info');
      logger.info('test message');
      const call = consoleSpy.info.mock.calls[0][0] as string;
      expect(call).toContain('[INFO]');
      expect(call).toContain('[TestContext]');
      expect(call).toContain('test message');
    });

    it('should include data in messages when provided', () => {
      const logger = new Logger('Test', 'info');
      logger.info('test message', { key: 'value' });
      const call = consoleSpy.info.mock.calls[0][0] as string;
      expect(call).toContain('{"key":"value"}');
    });

    it('should include error details in error messages', () => {
      const logger = new Logger('Test', 'error');
      const error = new Error('test error');
      logger.error('error occurred', error);
      const call = consoleSpy.error.mock.calls[0][0] as string;
      expect(call).toContain('test error');
    });
  });

  describe('setLevel', () => {
    it('should change the log level', () => {
      const logger = new Logger('Test', 'info');
      logger.debug('should not log');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      
      logger.setLevel('debug');
      logger.debug('should log');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });
  });

  describe('createLogger', () => {
    it('should create a logger with default info level', () => {
      const logger = createLogger('Test');
      logger.debug('should not log');
      expect(consoleSpy.debug).not.toHaveBeenCalled();
      logger.info('should log');
      expect(consoleSpy.info).toHaveBeenCalled();
    });

    it('should create a logger with specified level', () => {
      const logger = createLogger('Test', 'debug');
      logger.debug('should log');
      expect(consoleSpy.debug).toHaveBeenCalled();
    });
  });
});
