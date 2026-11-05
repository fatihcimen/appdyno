import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceError } from '@appdyno/protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_POLICY, ServerContext, ToolError } from '../src/index.js';
import { FakeDevice } from './fake-device.js';
import { callerOf, linkedClient } from './helpers.js';

const contextOf = (device: FakeDevice) =>
  new ServerContext(
    DEFAULT_POLICY,
    [
      {
        list: async () => [{ serial: device.serial, state: 'device', ready: true }],
        handles: () => true,
        open: () => device,
      },
    ],
    { device: device.serial, app: 'dev.app' },
  );

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('it did not refuse');
    },
    (e: unknown) => {
      expect(e).toBeInstanceOf(ToolError);
      return e as ToolError;
    },
  );

const namesOf = (d: FakeDevice) => d.calls.map((c) => c.name);

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-guards-')));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('what did not happen is no success', () => {
  const client = (device: FakeDevice) => linkedClient(contextOf(device));
  const asked = async (device: FakeDevice, name: string, args: Record<string, unknown>) =>
    (await (await client(device)).callTool({ name, arguments: args })) as {
      isError?: boolean;
      structuredContent: Record<string, unknown>;
      content: { text: string }[];
    };

  it('a wait that ran out refuses, with the screen it saw', async () => {
    const r = await asked(new FakeDevice(), 'wait_for', { text: 'Never', timeoutMs: 300 });
    expect(r.isError).toBe(true);
    expect(r.structuredContent.code).toBe('TIMEOUT');
    expect(r.content[0]!.text).toContain('not shown after 300 ms');
    expect(r.content[0]!.text).toContain('Ana sayfa');
  });

  it('so does one with nothing asked of the screen', async () => {
    const e = await refusal(
      callerOf(contextOf(new FakeDevice()))('wait_for', {
        text: 'Never',
        timeoutMs: 300,
        read: 'none',
      }),
    );
    expect(e.code).toBe('TIMEOUT');
    expect(e.message).toBe('not shown after 300 ms');
  });

  it('a wait for what goes refuses while it stays', async () => {
    const e = await refusal(
      callerOf(contextOf(new FakeDevice()))('wait_for', {
        text: 'Ana sayfa',
        gone: true,
        timeoutMs: 300,
      }),
    );
    expect(e.code).toBe('TIMEOUT');
    expect(e.message).toContain('still there after 300 ms');
  });

  it('an answer to no alert refuses, and touched nothing', async () => {
    const device = new FakeDevice();
    const r = await asked(device, 'alert', { answer: 'allow' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ code: 'NOT_FOUND', dispatched: false });
    expect(r.content[0]!.text).toContain('no system alert is open');
    expect(namesOf(device)).not.toContain('act');
  });

  it('asking whether an alert is open is no refusal', async () => {
    const r = await asked(new FakeDevice(), 'alert', {});
    expect(r.isError).toBeFalsy();
    expect(r.content[0]!.text).toContain('no system alert is open');
  });

  it('a sequence stops at an answer to no alert', async () => {
    const device = new FakeDevice();
    const e = await refusal(
      callerOf(contextOf(device))('steps', {
        steps: [
          { action: 'alert', answer: 'allow' },
          { action: 'press_key', key: 'back' },
        ],
      }),
    );
    expect(e.code).toBe('NOT_FOUND');
    expect(namesOf(device)).not.toContain('act');
  });
});

describe('a failed action says whether its touch went out', () => {
  it('no: nothing named the target', async () => {
    const call = callerOf(contextOf(new FakeDevice()));
    const e = await refusal(call('tap', { selector: { text: 'Nothing like it' } }));
    expect(e.dispatched).toBe(false);
    expect(e.message).toContain('no touch was sent');
  });

  it('no: the device refused before the touch', async () => {
    const device = new FakeDevice();
    device.act = async () => {
      throw new DeviceError('STALE', 'another window came in front');
    };
    const e = await refusal(callerOf(contextOf(device))('tap', { x: 10, y: 10 }));
    expect(e.code).toBe('STALE');
    expect(e.dispatched).toBe(false);
  });

  it.each(['TIMEOUT', 'DEVICE_GONE', 'AGENT_UNAVAILABLE'] as const)(
    'unknown: %s, as it may have made the touch first',
    async (code) => {
      const device = new FakeDevice();
      device.act = async () => {
        throw new DeviceError(code, 'it stopped answering');
      };
      const e = await refusal(callerOf(contextOf(device))('tap', { x: 10, y: 10 }));
      expect(e.dispatched).toBe('unknown');
      expect(e.message).toContain('read the screen before trying again');
    },
  );

  it('unknown: what failed after the action went out, whatever its code: the read after a touch can fail', async () => {
    const device = new FakeDevice();
    device.act = async () => {
      const e = new DeviceError('NOT_FOUND', 'no window to read');
      e.sent = true;
      throw e;
    };
    const e = await refusal(callerOf(contextOf(device))('press_key', { key: 'home' }));
    expect(e.code).toBe('NOT_FOUND');
    expect(e.dispatched).toBe('unknown');
    expect(e.message).toContain('the touch may have been sent');
    expect(e.message).not.toContain('no touch was sent');
  });

  it('no: a look at the screen that failed before the touch', async () => {
    const device = new FakeDevice();
    device.tree = async () => {
      throw new DeviceError('NOT_FOUND', 'no window to read');
    };
    const e = await refusal(callerOf(contextOf(device))('tap', { x: 10, y: 10 }));
    expect(e.dispatched).toBe(false);
    expect(namesOf(device)).not.toContain('act');
  });

  it.each(['power', 'lock'] as const)(
    'presses %s with no look first: a look would wake a dark screen, and the key would put it back',
    async (key) => {
      const device = new FakeDevice();
      await callerOf(contextOf(device))('press_key', { key });
      expect(namesOf(device)).toEqual(['act']);
    },
  );

  it('yes: a scroll that found nothing swiped', async () => {
    const e = await refusal(
      callerOf(contextOf(new FakeDevice()))('scroll_to', { selector: { text: 'Nowhere' } }),
    );
    expect(e.dispatched).toBe(true);
    expect(e.message).toContain('the touch was sent');
  });

  it('says it in a sequence, and to a client in its data', async () => {
    const device = new FakeDevice();
    const ctx = contextOf(device);
    const e = await refusal(
      callerOf(ctx)('steps', {
        steps: [{ action: 'tap', selector: { text: 'Nothing like it' } }],
      }),
    );
    expect(e.dispatched).toBe(false);
    const client = await linkedClient(ctx);
    const r = (await client.callTool({
      name: 'tap',
      arguments: { selector: { text: 'Nothing like it' } },
    })) as { structuredContent: Record<string, unknown> };
    expect(r.structuredContent.dispatched).toBe(false);
  });
});

describe('a touch looks first', () => {
  it.each([
    ['tap', { x: 10, y: 10 }],
    ['swipe', { direction: 'up' }],
    ['press_key', { key: 'back' }],
    ['gesture', { kind: 'plan', pointers: [[{ x: 1, y: 1, t: 0 }]] }],
  ])('%s reads a screen nobody has seen before it touches it', async (op, args) => {
    const device = new FakeDevice();
    await callerOf(contextOf(device))(op as 'tap', args);
    const names = namesOf(device);
    expect(names).toContain('act');
    expect(names.indexOf('tree')).toBeLessThan(names.indexOf('act'));
    expect(names.indexOf('tree')).toBeGreaterThanOrEqual(0);
  });

  it('a phone that locked meanwhile refuses by name, and is not touched', async () => {
    const device = new FakeDevice();
    const real = device.tree.bind(device);
    device.tree = async () => {
      throw new DeviceError('DEVICE_LOCKED', 'it is locked behind its passcode', 'unlock it');
    };
    const e = await refusal(callerOf(contextOf(device))('swipe', { direction: 'up' }));
    expect(e.code).toBe('DEVICE_LOCKED');
    expect(e.dispatched).toBe(false);
    expect(e.message).toContain('locked behind its passcode');
    expect(namesOf(device)).not.toContain('act');
    device.tree = real;
  });

  it('a read that was refused leaves nothing to trust: the next touch looks again', async () => {
    const device = new FakeDevice();
    const call = callerOf(contextOf(device));
    await call('screen');
    const real = device.tree.bind(device);
    device.tree = async () => {
      throw new DeviceError('DEVICE_LOCKED', 'it is locked behind its PIN');
    };
    await refusal(call('screen'));
    const e = await refusal(call('tap', { x: 10, y: 10 }));
    expect(e.code).toBe('DEVICE_LOCKED');
    expect(namesOf(device)).not.toContain('act');
    device.tree = real;
  });

  it('reads no more than it must: a read just taken is enough', async () => {
    const device = new FakeDevice();
    const call = callerOf(contextOf(device));
    await call('screen');
    const before = namesOf(device).filter((n) => n === 'tree').length;
    await call('tap', { x: 10, y: 10 });
    expect(namesOf(device).filter((n) => n === 'tree').length).toBe(before);
  });

  it('a read of a while ago is no look: a phone locks after a minute', async () => {
    const device = new FakeDevice();
    const call = callerOf(contextOf(device));
    await call('screen');
    const before = namesOf(device).filter((n) => n === 'tree').length;
    const later = Date.now() + 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await call('tap', { x: 10, y: 10 });
    expect(namesOf(device).filter((n) => n === 'tree').length).toBe(before + 1);
  });
});
