import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('a refusal of a call that names too little', () => {
  it('says where an app is found when the call names none and none is selected', async () => {
    const { call } = await connect(new FakeDevice(), { defaults: { app: undefined } });
    for (const r of [await call('logs'), await call('terminate_app'), await call('crashes')])
      expect(r.text).toBe(
        'INVALID_ARGUMENT: give app (or select one with use_device)\nhint: app action list names the installed apps by id; use_device with app selects one for the calls after',
      );
  });

  it('says what a person sets to allow what the server refuses, and how to get a device', async () => {
    const narrow = await connect(new FakeDevice(), {
      policy: { urls: /^https:\/\/ok\./, allowHome: false },
    });
    expect((await narrow.call('open_link', { url: 'https://no.example' })).data.hint).toBe(
      'the person who runs this server allows it by --allow-urls, and no call can',
    );
    expect((await narrow.call('open_link', { settings: 'wifi' })).data.hint).toBe(
      'the person who runs this server allows it by starting it without --no-home, and no call can',
    );
    const none = new ServerContext(DEFAULT_POLICY, [
      { list: () => Promise.resolve([]), handles: () => false, open: () => new FakeDevice() },
    ]);
    const e = await none.defaultSerial().catch((x: unknown) => x);
    expect(e).toMatchObject({
      code: 'DEVICE_GONE',
      hint: expect.stringContaining('simulator action list names') as unknown,
    });
  });

  it('says where the words a find may name are, when it names none', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('find')).text).toBe(
      'INVALID_ARGUMENT: give text, id or role\nhint: screen lists the elements, each by its ref, role and words',
    );
    expect((await call('tap')).data.hint).toBe(
      'screen lists the elements, each by its ref, role and words',
    );
  });
});
