import { jest, describe, it, expect, beforeEach } from '@jest/globals';

const mockCreate = jest.fn<(...args: any[]) => Promise<any>>();
const mockInfo = jest.fn<(...args: any[]) => Promise<any>>();
const mockSaveImage = jest.fn<(...args: any[]) => Promise<any>>();
const mockThumbnail = jest.fn<(...args: any[]) => Promise<any>>();

jest.unstable_mockModule('screenshotcenter', () => ({
  ScreenshotCenterClient: jest.fn().mockImplementation(() => ({
    screenshot: {
      create: mockCreate,
      info: mockInfo,
      saveImage: mockSaveImage,
      thumbnail: mockThumbnail,
    },
  })),
}));

const { ScreenshotCenterEvents } = await import('../src/events.js');
const { ScreenshotCenterClient } = await import('screenshotcenter');

function waitForEvent(emitter: any, event: string, timeoutMs = 5000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    emitter.once(event, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('ScreenshotCenterEvents', () => {
  describe('constructor', () => {
    it('creates a client with the given API key', () => {
      const events = new ScreenshotCenterEvents('test-key');
      expect(ScreenshotCenterClient).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseUrl: undefined,
        timeout: undefined,
      });
      expect(events.screenshotcenter).toBeDefined();
    });

    it('passes options to the underlying client', () => {
      new ScreenshotCenterEvents('key', false, {
        baseUrl: 'https://custom.api',
        requestTimeout: 5000,
      });
      expect(ScreenshotCenterClient).toHaveBeenCalledWith({
        apiKey: 'key',
        baseUrl: 'https://custom.api',
        timeout: 5000,
      });
    });
  });

  describe('setDefaults', () => {
    it('updates timeout and interval', () => {
      const events = new ScreenshotCenterEvents('key');
      events.setDefaults({ timeout: 120, interval: 5 });
      expect(events).toBeDefined();
    });
  });

  describe('screenshotCreate', () => {
    it('emits "processing" then "finished" after polling', async () => {
      mockCreate.mockResolvedValue({
        id: 100,
        status: 'processing',
        url: 'https://example.com',
      });
      mockInfo.mockResolvedValue({
        id: 100,
        status: 'finished',
        url: 'https://example.com',
        final_url: 'https://example.com',
      });

      const events = new ScreenshotCenterEvents('key');
      events.setDefaults({ interval: 0.1, timeout: 60 });

      const emitter = events.screenshotCreate({ url: 'https://example.com' });

      const processing = await waitForEvent(emitter, 'processing');
      expect(processing).toMatchObject({
        id: 100,
        status: 'processing',
        original_url: 'https://example.com',
      });

      const finished = await waitForEvent(emitter, 'finished');
      expect(finished).toMatchObject({
        id: 100,
        status: 'finished',
      });
    });

    it('emits "in_process" as an alias for "processing"', async () => {
      mockCreate.mockResolvedValue({
        id: 101,
        status: 'processing',
        url: 'https://example.com',
      });

      const events = new ScreenshotCenterEvents('key');
      events.setDefaults({ interval: 0.1, timeout: 60 });

      const emitter = events.screenshotCreate({ url: 'https://example.com' });

      const result = await waitForEvent(emitter, 'in_process');
      expect(result).toMatchObject({ id: 101 });
    });

    it('emits "failed" when create returns error status', async () => {
      mockCreate.mockResolvedValue({
        id: 200,
        status: 'error',
        url: 'https://bad.com',
        error: 'Invalid URL',
      });

      const events = new ScreenshotCenterEvents('key');
      const emitter = events.screenshotCreate({ url: 'https://bad.com' });

      const result = await waitForEvent(emitter, 'failed');
      expect(result).toMatchObject({
        id: 200,
        status: 'error',
        original_url: 'https://bad.com',
      });
    });

    it('emits "failed" when the API call rejects', async () => {
      mockCreate.mockRejectedValue(new Error('Network error'));

      const events = new ScreenshotCenterEvents('key');
      const emitter = events.screenshotCreate({ url: 'https://example.com' });

      const result = await waitForEvent(emitter, 'failed');
      expect(result).toMatchObject({
        id: 0,
        status: 'error',
        error: 'Network error',
        original_url: 'https://example.com',
      });
    });

    it('emits "timeout" when the screenshot takes too long', async () => {
      mockCreate.mockResolvedValue({
        id: 300,
        status: 'processing',
        url: 'https://slow.com',
      });
      mockInfo.mockResolvedValue({
        id: 300,
        status: 'processing',
        url: 'https://slow.com',
      });

      const events = new ScreenshotCenterEvents('key');
      events.setDefaults({ timeout: 0.3, interval: 0.1 });

      const emitter = events.screenshotCreate({ url: 'https://slow.com' });

      const result = await waitForEvent(emitter, 'timeout');
      expect(result).toMatchObject({ id: 300 });
    });

    it('preserves original_url through polling', async () => {
      mockCreate.mockResolvedValue({
        id: 400,
        status: 'processing',
        url: 'https://redirected.com',
      });
      mockInfo.mockResolvedValue({
        id: 400,
        status: 'finished',
        url: 'https://redirected.com',
        final_url: 'https://final.com',
      });

      const events = new ScreenshotCenterEvents('key');
      events.setDefaults({ interval: 0.1, timeout: 60 });

      const emitter = events.screenshotCreate({ url: 'https://original.com' });

      const result = await waitForEvent(emitter, 'finished');
      expect(result.original_url).toBe('https://original.com');
    });
  });

  describe('screenshotCreateMultiple', () => {
    it('emits events for each screenshot and "complete" when all are done', async () => {
      let callCount = 0;
      mockCreate.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          id: callCount,
          status: 'finished',
          url: `https://site${callCount}.com`,
        });
      });

      const events = new ScreenshotCenterEvents('key');

      const emitter = events.screenshotCreateMultiple(
        [{ url: 'https://site1.com' }, { url: 'https://site2.com' }],
        {}
      );

      const result = await waitForEvent(emitter, 'complete');
      expect(result).toHaveLength(2);
    });

    it('handles a mix of finished and failed screenshots', async () => {
      let callCount = 0;
      mockCreate.mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          return Promise.resolve({
            id: callCount,
            status: 'error',
            url: 'https://bad.com',
            error: 'Failed',
          });
        }
        return Promise.resolve({
          id: callCount,
          status: 'finished',
          url: `https://site${callCount}.com`,
        });
      });

      const events = new ScreenshotCenterEvents('key');
      const failedFn = jest.fn();

      const emitter = events
        .screenshotCreateMultiple(
          [{ url: 'https://site1.com' }, { url: 'https://bad.com' }],
          {}
        )
        .on('failed', failedFn);

      const result = await waitForEvent(emitter, 'complete');
      expect(result).toHaveLength(2);
      expect(failedFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('saveThumbnail', () => {
    it('saves to the given file path and returns it', async () => {
      mockSaveImage.mockResolvedValue(undefined);

      const events = new ScreenshotCenterEvents('key');
      const result = await events.saveThumbnail(123, '/tmp/shot.png');

      expect(mockSaveImage).toHaveBeenCalledWith(123, '/tmp/shot.png', {});
      expect(result).toBe('/tmp/shot.png');
    });
  });

  describe('screenshotThumbnail', () => {
    it('returns the image buffer', async () => {
      const buf = Buffer.from('fake-image');
      mockThumbnail.mockResolvedValue(buf);

      const events = new ScreenshotCenterEvents('key');
      const result = await events.screenshotThumbnail(123);

      expect(mockThumbnail).toHaveBeenCalledWith(123, {});
      expect(result).toBe(buf);
    });
  });

  describe('shotThumbnail', () => {
    it('returns [buffer, shot] tuple', async () => {
      const buf = Buffer.from('fake-image');
      mockThumbnail.mockResolvedValue(buf);

      const events = new ScreenshotCenterEvents('key');
      const result = await events.shotThumbnail(123, { shot: 2 });

      expect(result).toEqual([buf, 2]);
    });

    it('defaults shot to 1 when not specified', async () => {
      const buf = Buffer.from('fake-image');
      mockThumbnail.mockResolvedValue(buf);

      const events = new ScreenshotCenterEvents('key');
      const result = await events.shotThumbnail(123);

      expect(result).toEqual([buf, 1]);
    });
  });
});
