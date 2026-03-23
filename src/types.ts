import type { EventEmitter } from 'events';

export interface ScreenshotCenterEventsOptions {
  /** Base URL for the API (default: https://api.screenshotcenter.com/api/v1) */
  baseUrl?: string;
  /** Request timeout in milliseconds (default: 30_000) */
  requestTimeout?: number;
}

export interface Defaults {
  /** Max seconds to wait for a screenshot before firing 'timeout' (default: 300) */
  timeout: number;
  /** Seconds between status polls (default: 1) */
  interval: number;
}

export interface CreateArgs {
  url: string;
  /** Any additional ScreenshotCenter API parameters */
  [key: string]: unknown;
}

export interface ScreenshotEvent {
  id: number;
  status: string;
  url: string;
  original_url: string;
  error?: string | null;
  [key: string]: unknown;
}

/**
 * EventEmitter returned by screenshotCreate().
 *
 * Events:
 * - `in_queue`   — screenshot is queued (alias: `processing` status before work starts)
 * - `in_process` — screenshot is being processed (alias: `processing` status)
 * - `finished`   — screenshot completed successfully
 * - `failed`     — screenshot failed
 * - `timeout`    — screenshot did not finish within the configured timeout
 */
export interface ScreenshotEventEmitter extends EventEmitter {
  on(event: 'in_queue', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: 'in_process', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: 'processing', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: 'finished', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: 'failed', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: 'timeout', listener: (screenshot: ScreenshotEvent) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;

  once(event: 'in_queue', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: 'in_process', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: 'processing', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: 'finished', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: 'failed', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: 'timeout', listener: (screenshot: ScreenshotEvent) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
}

/**
 * EventEmitter returned by screenshotCreateMultiple().
 *
 * Same per-screenshot events as ScreenshotEventEmitter, plus:
 * - `complete` — all screenshots are done (finished, failed, or timed out)
 */
export interface MultipleScreenshotEventEmitter extends ScreenshotEventEmitter {
  on(event: 'complete', listener: (screenshots: ScreenshotEvent[]) => void): this;
  on(event: string, listener: (...args: any[]) => void): this;

  once(event: 'complete', listener: (screenshots: ScreenshotEvent[]) => void): this;
  once(event: string, listener: (...args: any[]) => void): this;
}
