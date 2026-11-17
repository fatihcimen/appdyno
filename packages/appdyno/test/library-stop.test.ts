import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as library from '../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';

const device = new FakeDevice();

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => device,
    },
  ],
}));

describe("a replay stopped in its flow's setup", () => {
  it('says the device was touched once a setup step was done', async () => {
    device.screen = 'home';
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-library-'));
    writeFileSync(join(dir, '_setup.flow'), 'tap text="Form"\ntap text="Gönder"\n');
    const flow = join(dir, 'a.flow');
    writeFileSync(flow, 'assert text="Gönderildi"\n');
    const act = device.act.bind(device);
    const stop = new AbortController();
    let acts = 0;
    // the stop comes as the setup's second touch begins: its first was done
    device.act = (...a) => {
      if (++acts === 2) stop.abort();
      return act(...a);
    };
    const d = library.connect();
    try {
      await expect(d.replay(flow, { signal: stop.signal })).rejects.toMatchObject({
        code: 'CANCELLED',
        dispatched: true,
      });
    } finally {
      device.act = act;
      await d.close();
    }
  });
});
