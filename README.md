# screenshotcenter-events

Event-driven library for [ScreenshotCenter](https://screenshotcenter.com/). Works on top of the [`screenshotcenter`](https://www.npmjs.com/package/screenshotcenter) SDK to provide an event interface for following the stages of a screenshot: `processing`, `finished`, or `failed`.

This package is a **drop-in replacement** for [`browshot-events`](https://www.npmjs.com/package/browshot-events) — the API is compatible so you can migrate by changing the import and constructor.

## Installation

```bash
npm install screenshotcenter-events
```

## Quick Start

```javascript
import { ScreenshotCenterEvents } from 'screenshotcenter-events';

const client = new ScreenshotCenterEvents('my_api_key');
client.setDefaults({ timeout: 60 * 60, interval: 10 });

client.screenshotCreate({ url: 'https://www.google.com/', country: 'us' })
  .on('processing', (screenshot) => {
    console.log(`Screenshot ${screenshot.id} is processing`);
  })
  .on('finished', (screenshot) => {
    console.log(`Screenshot ${screenshot.id} is finished`);

    client.saveThumbnail(screenshot.id, 'google.png')
      .then((file) => console.log(`Screenshot saved to ${file}`))
      .catch((err) => console.log(`Failed to save: ${err}`));
  })
  .on('failed', (screenshot) => {
    console.log(`Screenshot ${screenshot.id} failed: ${screenshot.error}`);
  })
  .on('timeout', (screenshot) => {
    console.log(`Screenshot ${screenshot.id} is taking too long`);
  });
```

### CommonJS

```javascript
const { ScreenshotCenterEvents } = require('screenshotcenter-events');

const client = new ScreenshotCenterEvents('my_api_key');
// ...same API as above
```

## API

### `new ScreenshotCenterEvents(key, debug?, options?)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `key` | `string` | Your ScreenshotCenter API key. Required. |
| `debug` | `boolean` | Enable debug logging (default: `false`). |
| `options.baseUrl` | `string` | Override the API base URL. |
| `options.requestTimeout` | `number` | HTTP request timeout in ms (default: 30000). |

### `client.setDefaults(args)`

Change the default polling settings:

| Setting | Type | Default | Description |
|---------|------|---------|-------------|
| `timeout` | `number` | `300` | Max seconds to wait before firing `timeout`. |
| `interval` | `number` | `1` | Seconds between status polls. |

### `client.screenshotCreate(args)` → `EventEmitter`

Request a screenshot and return an EventEmitter.

**Events:**

| Event | Argument | Description |
|-------|----------|-------------|
| `processing` | `ScreenshotEvent` | Screenshot is being processed. |
| `in_process` | `ScreenshotEvent` | Alias for `processing` (browshot-events compat). |
| `finished` | `ScreenshotEvent` | Screenshot completed successfully. |
| `failed` | `ScreenshotEvent` | Screenshot failed. |
| `timeout` | `ScreenshotEvent` | Exceeded the configured timeout. |

The `ScreenshotEvent` object includes all fields from the API response, plus `original_url` (the URL you originally requested, before any redirects).

### `client.screenshotCreateMultiple(args, common?, delay?, successive?)` → `EventEmitter`

Request multiple screenshots at once. Fires the same per-screenshot events as `screenshotCreate`, plus:

| Event | Argument | Description |
|-------|----------|-------------|
| `complete` | `ScreenshotEvent[]` | All screenshots are done (finished, failed, or timed out). |

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `args` | `CreateArgs[]` | | Array of per-screenshot request objects. |
| `common` | `object` | `{}` | Properties merged into every request. |
| `delay` | `number` | `0` | Seconds to wait between requests. |
| `successive` | `boolean` | `false` | Wait for each screenshot to finish before starting the next. |

### `client.saveThumbnail(id, file, args?)` → `Promise<string>`

Download a screenshot and save it to a local file. Returns the file path.

### `client.screenshotThumbnail(id, args?)` → `Promise<Buffer>`

Retrieve a screenshot thumbnail as a Buffer.

### `client.shotThumbnail(id, args?)` → `Promise<[Buffer, number]>`

Retrieve a screenshot thumbnail as a `[buffer, shotIndex]` tuple.

### `client.screenshotcenter`

Access the underlying [`screenshotcenter`](https://www.npmjs.com/package/screenshotcenter) SDK client for any API call not covered by the events interface (batches, crawls, account info, etc.).

```javascript
const account = await client.screenshotcenter.account.info();
console.log(`Balance: ${account.balance}`);
```

## Migrating from browshot-events

| browshot-events | screenshotcenter-events |
|----------------|------------------------|
| `require('browshot-events')` | `require('screenshotcenter-events').ScreenshotCenterEvents` |
| `new browshot(key)` | `new ScreenshotCenterEvents(key)` |
| `client.browshot` | `client.screenshotcenter` |
| `'in_queue'` event | `'processing'` event (ScreenshotCenter uses a single status) |
| `'in_process'` event | `'in_process'` event (still emitted as an alias) |
| `instance_id` param | Not needed (ScreenshotCenter manages browser instances) |

## License

MIT
