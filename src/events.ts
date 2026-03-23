import { EventEmitter } from 'events';
import { ScreenshotCenterClient } from 'screenshotcenter';
import type {
  ScreenshotCenterEventsOptions,
  Defaults,
  CreateArgs,
  ScreenshotEvent,
  ScreenshotEventEmitter,
  MultipleScreenshotEventEmitter,
} from './types.js';

const DEFAULT_DEFAULTS: Defaults = {
  timeout: 60 * 5,
  interval: 1,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Normalize a ScreenshotCenter API status to a browshot-events compatible
 * event name. ScreenshotCenter uses `processing` for both queued and
 * in-progress states, while browshot-events distinguished `in_queue` and
 * `in_process`.  We emit `processing` (the native status) *and* `in_process`
 * for backward compatibility.  If the status is `error`, we emit `failed`
 * (matching browshot-events convention).
 */
function statusToEvent(status: string): string {
  if (status === 'error') return 'failed';
  return status;
}

export class ScreenshotCenterEvents {
  /** The underlying ScreenshotCenter SDK client — use for any API call not
   *  covered by the events interface. */
  readonly screenshotcenter: ScreenshotCenterClient;

  private defaults: Defaults = { ...DEFAULT_DEFAULTS };
  private debug: boolean;

  /**
   * @param key   Your ScreenshotCenter API key.
   * @param debug Enable debug logging to stdout (default: false).
   * @param options Additional client options (baseUrl, requestTimeout).
   */
  constructor(key: string, debug = false, options?: ScreenshotCenterEventsOptions) {
    this.debug = debug;
    this.screenshotcenter = new ScreenshotCenterClient({
      apiKey: key,
      baseUrl: options?.baseUrl,
      timeout: options?.requestTimeout,
    });
  }

  private info(...args: unknown[]): void {
    if (this.debug) console.log(...args);
  }

  /**
   * Change the default polling settings.
   *
   * @param args.timeout  Max seconds to wait before firing `timeout` (default: 300).
   * @param args.interval Seconds between status polls (default: 1).
   */
  setDefaults(args: Partial<Defaults>): void {
    this.defaults = { ...this.defaults, ...args };
  }

  /**
   * Request a screenshot and return an EventEmitter that fires status events
   * as the screenshot progresses.
   *
   * Events:
   * - `in_queue`    — screenshot is queued
   * - `in_process`  — screenshot is being processed
   * - `processing`  — alias for in_process (native ScreenshotCenter status)
   * - `finished`    — screenshot completed
   * - `failed`      — screenshot errored
   * - `timeout`     — exceeded the configured timeout
   *
   * @example
   * client.screenshotCreate({ url: 'https://example.com' })
   *   .once('in_queue', (s) => console.log(`Queued: ${s.id}`))
   *   .on('finished', (s) => console.log(`Done: ${s.id}`))
   *   .on('failed', (s) => console.log(`Failed: ${s.id}`))
   *   .on('timeout', (s) => console.log(`Timeout: ${s.id}`));
   */
  screenshotCreate(args: CreateArgs = { url: '' }): ScreenshotEventEmitter {
    const emitter = new EventEmitter() as ScreenshotEventEmitter;
    const start = Date.now();
    const originalUrl = args.url || '';

    const emitStatus = (screenshot: ScreenshotEvent): void => {
      const event = statusToEvent(screenshot.status);
      emitter.emit(event, screenshot);
      if (screenshot.status === 'processing') {
        emitter.emit('in_process', screenshot);
      }
    };

    const checkTimeout = (screenshot: ScreenshotEvent): boolean => {
      if (Date.now() - start >= this.defaults.timeout * 1000) {
        emitter.emit('timeout', screenshot);
        emitter.removeAllListeners();
        return true;
      }
      return false;
    };

    const checkStatus = (id: number): void => {
      this.screenshotcenter.screenshot
        .info(id)
        .then((raw) => {
          const screenshot: ScreenshotEvent = {
            ...raw,
            original_url: originalUrl,
          } as ScreenshotEvent;

          emitStatus(screenshot);

          if (screenshot.status === 'finished' || screenshot.status === 'error') {
            emitter.removeAllListeners();
          } else if (!checkTimeout(screenshot)) {
            setTimeout(() => checkStatus(id), this.defaults.interval * 1000);
          }
        })
        .catch((err: unknown) => {
          this.info('Error checking screenshot status:', err);
          if (!checkTimeout({ id, status: 'processing', url: originalUrl, original_url: originalUrl })) {
            setTimeout(() => checkStatus(id), this.defaults.interval * 1000);
          }
        });
    };

    this.screenshotcenter.screenshot
      .create(args)
      .then((raw) => {
        const screenshot: ScreenshotEvent = {
          ...raw,
          original_url: originalUrl,
        } as ScreenshotEvent;

        emitStatus(screenshot);

        if (screenshot.status === 'finished' || screenshot.status === 'error') {
          emitter.removeAllListeners();
        } else if (!checkTimeout(screenshot)) {
          setTimeout(() => checkStatus(screenshot.id), this.defaults.interval * 1000);
        }
      })
      .catch((err: unknown) => {
        emitter.emit('failed', {
          id: 0,
          status: 'error',
          url: originalUrl,
          original_url: originalUrl,
          error: err instanceof Error ? err.message : String(err),
        });
        emitter.removeAllListeners();
      });

    return emitter;
  }

  /**
   * Request multiple screenshots at once. Returns an EventEmitter with the
   * same per-screenshot events as {@link screenshotCreate}, plus a `complete`
   * event that fires once when all screenshots are done.
   *
   * @param args             Array of per-screenshot request objects.
   * @param common           Properties merged into every request.
   * @param delayScreenshot  Seconds to wait between requests (default: 0).
   * @param successive       Wait for each screenshot to finish before starting
   *                         the next (default: false).
   *
   * @example
   * client.screenshotCreateMultiple(
   *   [{ url: 'https://a.com' }, { url: 'https://b.com' }],
   *   { country: 'us' }
   * )
   *   .on('finished', (s) => console.log(`Done: ${s.id}`))
   *   .on('complete', (all) => console.log(`All done: ${all.length} screenshots`));
   */
  screenshotCreateMultiple(
    args: CreateArgs[] = [],
    common: Record<string, unknown> = {},
    delayScreenshot = 0,
    successive = false
  ): MultipleScreenshotEventEmitter {
    const emitter = new EventEmitter() as MultipleScreenshotEventEmitter;
    let start = Date.now();
    const screenshots: ScreenshotEvent[] = [];
    const totalExpected = args.length;

    const emitStatus = (screenshot: ScreenshotEvent): void => {
      const event = statusToEvent(screenshot.status);
      emitter.emit(event, screenshot);
      if (screenshot.status === 'processing') {
        emitter.emit('in_process', screenshot);
      }
    };

    const checkTimeout = (): boolean => {
      if (Date.now() - start >= this.defaults.timeout * 1000) {
        emitter.emit('timeout', screenshots);
        emitter.removeAllListeners();
        return true;
      }
      return false;
    };

    const checkCompleted = (): boolean => {
      const allDone = screenshots.length === totalExpected &&
        screenshots.every((s) => s.status === 'finished' || s.status === 'error');
      if (allDone) {
        emitter.emit('complete', screenshots);
        this.info('All screenshots are complete');
        emitter.removeAllListeners();
      }
      return allDone;
    };

    const checkStatus = (idx: number): void => {
      const current = screenshots[idx];
      if (!current || current.status === 'finished' || current.status === 'error') return;

      this.screenshotcenter.screenshot
        .info(current.id)
        .then((raw) => {
          const updated: ScreenshotEvent = {
            ...raw,
            original_url: current.original_url,
          } as ScreenshotEvent;
          screenshots[idx] = updated;

          emitStatus(updated);

          if (updated.status === 'finished' || updated.status === 'error') {
            checkCompleted();
          } else if (!checkTimeout()) {
            setTimeout(() => checkStatus(idx), this.defaults.interval * 1000);
          }
        })
        .catch((err: unknown) => {
          this.info('Error checking screenshot status:', err);
          if (!checkTimeout()) {
            setTimeout(() => checkStatus(idx), this.defaults.interval * 1000);
          }
        });
    };

    const processRequests = async (): Promise<void> => {
      for (let i = 0; i < args.length; i++) {
        if (delayScreenshot > 0 && i > 0) {
          await sleep(delayScreenshot * 1000);
          start = Date.now();
        }

        if (successive && i > 0) {
          while (!screenshots.every((s) => s.status === 'finished' || s.status === 'error') || screenshots.length < i) {
            await sleep(1000);
          }
          start = Date.now();
        }

        const merged: CreateArgs = { ...common, ...args[i] } as CreateArgs;
        const originalUrl = merged.url || '';

        try {
          const raw = await this.screenshotcenter.screenshot.create(merged);
          const screenshot: ScreenshotEvent = {
            ...raw,
            original_url: originalUrl,
          } as ScreenshotEvent;
          screenshots.push(screenshot);

          emitStatus(screenshot);

          if (screenshot.status === 'finished' || screenshot.status === 'error') {
            checkCompleted();
          } else if (!checkTimeout()) {
            const idx = screenshots.length - 1;
            setTimeout(() => checkStatus(idx), this.defaults.interval * 1000);
          }
        } catch (err: unknown) {
          const failedScreenshot: ScreenshotEvent = {
            id: 0,
            status: 'error',
            url: originalUrl,
            original_url: originalUrl,
            error: err instanceof Error ? err.message : String(err),
          };
          screenshots.push(failedScreenshot);
          emitStatus(failedScreenshot);
          checkCompleted();
        }
      }
    };

    processRequests().catch((err: unknown) => {
      this.info('Error in screenshotCreateMultiple:', err);
    });

    return emitter;
  }

  /**
   * Save a screenshot thumbnail to a local file.
   *
   * @param id   Screenshot ID.
   * @param file Local file path to write to.
   * @param args Additional thumbnail parameters (width, height, shot, etc.).
   * @returns    The file path on success.
   */
  async saveThumbnail(
    id: number,
    file: string,
    args: Record<string, unknown> = {}
  ): Promise<string> {
    await this.screenshotcenter.screenshot.saveImage(id, file, args);
    return file;
  }

  /**
   * Retrieve a screenshot thumbnail as a Buffer.
   *
   * @param id   Screenshot ID.
   * @param args Additional thumbnail parameters.
   * @returns    Image buffer.
   */
  async screenshotThumbnail(
    id: number,
    args: Record<string, unknown> = {}
  ): Promise<Buffer> {
    return this.screenshotcenter.screenshot.thumbnail(id, args);
  }

  /**
   * Retrieve a screenshot thumbnail as a Buffer along with the shot index.
   *
   * @param id   Screenshot ID.
   * @param args Additional thumbnail parameters (include `shot` for multi-shot).
   * @returns    Tuple of [imageBuffer, shotIndex].
   */
  async shotThumbnail(
    id: number,
    args: Record<string, unknown> = {}
  ): Promise<[Buffer, number]> {
    const image = await this.screenshotcenter.screenshot.thumbnail(id, args);
    return [image, (args.shot as number) || 1];
  }
}
