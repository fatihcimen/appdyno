import { DeviceQueue } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { refused, refusedAction, ToolError } from '../src/tool.js';

const caught = (run: () => never) => {
  try {
    run();
  } catch (e) {
    if (e instanceof ToolError) return e;
    throw e;
  }
};

describe('a call refused before anything of it left this host', () => {
  it('says its touch did not go, where a device that did not answer says it may have', async () => {
    const q = new DeviceQueue();
    let end = (): void => undefined;
    const first = q.run(() => new Promise<void>((done) => (end = done)));
    const waited = await q.run(() => Promise.resolve(), 10).catch((e: unknown) => e);
    end();
    await first;
    expect(caught(() => refused(waited))).toMatchObject({ code: 'TIMEOUT', dispatched: false });
    expect(caught(() => refusedAction(waited)).message).toMatch(/\(no touch was sent\)$/);
    const silent = new DeviceError('TIMEOUT', 'act did not answer within 15000 ms');
    expect(caught(() => refusedAction(silent))).toMatchObject({ dispatched: 'unknown' });
  });
});
