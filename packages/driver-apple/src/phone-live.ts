import { LIVE_FIELDS, type LiveMetrics, type LiveSample } from '@appdyno/core';
import { loadPhoneStream } from './mirror-phone.js';

/** An iPhone's numbers by its own instruments, with no runner and no `xctrace`. */
export class PhoneLive implements LiveMetrics {
  constructor(
    private readonly udid: string,
    private readonly load = loadPhoneStream,
  ) {}

  async start(onSample: (s: LiveSample) => void, app?: string) {
    const stream = await this.load();
    if (stream) return stream.live(this.udid, app, onSample);
    const why = 'this build holds no way to read an iPhone so';
    onSample({ at: Date.now(), absent: Object.fromEntries(LIVE_FIELDS.map((f) => [f, why])) });
    return () => undefined;
  }
}
