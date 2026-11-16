import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { SCREENS } from '@appdyno/testing/fake-screens.js';
import { openDevice, type Aimed, type Device, type Selector } from '../src/device.js';
import { connect } from '../src/library.js';

/** Its own serial: what holds a device is a file other tests of this run write too. */
const SERIAL = 'emulator-5658';
let device = new FakeDevice(SERIAL);

vi.mock('../src/providers.js', () => ({
  deviceProviders: () => [
    {
      list: () => Promise.resolve([]),
      handles: (s: string) => s.startsWith('emulator-'),
      open: () => device,
    },
  ],
}));

/** Where each way aims: the point, or the code of its refusal. */
type Outcome = { x: number; y: number } | { code: string };

const refusal = (e: unknown): Outcome => ({ code: (e as { code: string }).code });

/** Where a tool's tap on the target lands on a new fake device showing `screen`. */
async function byTool(screen: string, target: { ref: string } | { selector: Selector }) {
  device = new FakeDevice(SERIAL);
  device.screen = screen;
  const tools = connect({ device: SERIAL, app: 'dev.app', share: true });
  try {
    await tools.tool('tap', target);
    const act = must(
      device.calls.find((c) => c.name === 'act'),
      'the tap',
    ).args[0] as { x: number; y: number };
    return { x: act.x, y: act.y };
  } catch (e) {
    return refusal(e);
  } finally {
    await tools.close();
  }
}

const byDevice = (d: Device, target: Selector | { ref: string }): Promise<Outcome> =>
  d.aim(target, { waitMs: 0 }).then(({ point }: Aimed) => point, refusal);

describe('a tool and a device opened from code', () => {
  let points = 0;

  it.each(Object.keys(SCREENS))('aim at the same point on the screen %s', async (screen) => {
    device = new FakeDevice(SERIAL);
    device.screen = screen;
    const opened = await openDevice(SERIAL, { app: 'dev.app', share: true });
    const { elements } = await opened.screen();
    const targets: ({ ref: string } | { text: string })[] = elements
      .filter((e) => e.ref !== '@keyboard')
      .flatMap((e) => [{ ref: e.ref }, ...(e.label ? [{ text: e.label }] : [])]);
    const own = await Promise.all(targets.map((t) => byDevice(opened, t)));
    await opened.close();
    for (const [n, target] of targets.entries()) {
      const tool = await byTool(screen, 'ref' in target ? target : { selector: target });
      expect({ target, at: tool }).toEqual({ target, at: own[n] });
      if ('x' in tool) points += 1;
    }
  });

  it('were compared on touches that went out, not on refusals alone', () => {
    expect(points).toBeGreaterThan(40);
  });

  it('have the rule in one place: neither aims by a rule of its own', () => {
    const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
    for (const file of ['../src/device.ts', '../../ops/src/targets.ts']) {
      expect(source(file)).toMatch(/\bseek(On)?\(/);
      expect(source(file)).not.toMatch(/\b(oneOf|selectIn)\(.*\bindex\b/);
    }
  });

  /** What the device entry takes of the tool layer: the driver for a serial and the checks of the policy a server keeps, by name. */
  const OF_THE_TOOLS = ['ServerContext', 'checkApp', 'redact'];

  it('take of the tool layer, in the device entry, only what is named here', () => {
    const source = readFileSync(new URL('../src/device.ts', import.meta.url), 'utf8');
    const taken = [...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from '@appdyno\/ops'/g)]
      .flatMap((m) => must(m[1], 'its names').split(','))
      .map((name) => name.replace(/\btype\b/, '').trim())
      .filter(Boolean);
    expect(taken.sort()).toEqual(OF_THE_TOOLS);
  });
});
