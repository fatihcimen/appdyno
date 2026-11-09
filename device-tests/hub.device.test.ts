import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  viewerBinary,
  ViewerProcess,
  type Device,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { androidProvider } from '../packages/driver-android/src/index.js';
import { simulatorProvider } from '../packages/driver-apple/src/index.js';
import { conditions, DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { untilWithin } from './until.js';

/**
 * The hub's Device pane on our own running emulator (APPDYNO_ANDROID_SERIAL) or simulator (APPDYNO_IOS_UDID): never a
 * default, and only that device is listed. Its real window, kept off every screen: dark mode and the text size changed by
 * the pane's own controls, read on the device, then the window closed as a person closes it, and both read as they were
 * once the hub is done. APPDYNO_HUB_LOOK and APPDYNO_HUB_LANGUAGE pick how, and APPDYNO_SHOTS keeps a picture of each pane.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL ?? process.env.APPDYNO_IOS_UDID ?? '';
const android = !!process.env.APPDYNO_ANDROID_SERIAL;
const LIVE_MS = 180_000;
/** The first ask opens a session, which starts the device agent: on a simulator it may build its runner first. */
const FIRST_MS = 420_000;
const PANES = [
  'performance',
  'flows',
  'apps',
  'activity',
  'logs',
  'network',
  'accessibility',
  'device',
  'links',
  'push',
];

const until = untilWithin(30_000);

describe.runIf(serial)("the hub's Device pane", () => {
  const told: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  const shots = process.env.APPDYNO_SHOTS;
  const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
  const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
  let link: ViewerProcess;
  let done: Promise<number>;
  let device: Device;
  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const picture = async (name: string) => {
    if (!shots) return;
    link.send({
      op: 'snapshot',
      file: join(shots, `hub-${android ? 'android' : 'ios'}-${name}-${look}-${language}.png`),
    });
    await quiet(1_000);
  };
  const poke = (m: Record<string, unknown>) => link.send({ op: 'poke', stage: serial, ...m });
  /** The pane's answers since `from`. */
  const answers = (from: number) =>
    sent.slice(from).filter((m) => m.op === 'answer' && m.name === 'device');
  const answered = async (from: number, ms?: number) => {
    await until('an answer', () => answers(from).some((m) => 'ok' in m), ms);
    return answers(from).find((m) => 'ok' in m);
  };
  const read = (name: 'dark_mode' | 'text_size') => device.settings.get(name);

  beforeAll(async () => {
    const binary = await viewerBinary();
    const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^${serial}$`) };
    const ctx = new ServerContext(policy, [android ? androidProvider() : simulatorProvider()]);
    device = ctx.deviceFor(serial);
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          '--not-key',
          ...(language === 'tr' ? ['-AppleLanguages', '(tr)'] : []),
        ]);
        link.onMessage((m) => told.push(m));
        const send = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          send(m);
        };
        return link;
      },
    });
    await until('the hub', () => sent.some((m) => m.op === 'hub'));
    link.send({ op: 'poke', id: serial });
    await until(
      'the device live',
      () => told.some((m) => m.op === 'first' && m.stage === serial),
      LIVE_MS,
    );
  }, LIVE_MS + 60_000);

  afterAll(async () => {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    link?.send({ op: 'quit' });
    await done;
    device.close();
  }, 60_000);

  it(
    'reads each condition, sets two by its own controls, and puts them back as the window closes',
    async () => {
      const was = { dark: await read('dark_mode'), size: await read('text_size') };
      let from = sent.length;
      poke({ pane: PANES.indexOf('device') });
      await until(
        'the conditions',
        () => answers(from).some((m) => Array.isArray(m.conditions)),
        FIRST_MS,
      );
      const rows = answers(from).find((m) => Array.isArray(m.conditions))?.conditions as {
        name: string;
        why?: string;
      }[];
      expect(rows.find((r) => r.name === 'dark_mode')).not.toHaveProperty('why');
      // what the platform has not got says why, as device_setting does, in a person's words
      expect(
        rows.find((r) => r.name === (android ? 'reduce_transparency' : 'animations'))?.why,
      ).toBe(
        android
          ? 'Android has no Reduce Transparency setting.'
          : 'iOS has no animation speed setting. Use Reduce Motion.',
      );
      await quiet(1_000);
      await picture('device');
      const dark = /on|dark|yes/.test(was.dark) ? 'off' : 'on';
      // a size it is not at: Android's is a scale, iOS's a name
      const sizes = android ? ['1.3', '1.15'] : ['extra-large', 'large'];
      const size = sizes.find((s) => s !== was.size) ?? '';
      from = sent.length;
      poke({ condition: 'dark_mode', value: dark });
      expect(await answered(from)).toMatchObject({ ok: true, moved: true });
      from = sent.length;
      poke({ condition: 'text_size', value: size });
      expect(await answered(from)).toMatchObject({ ok: true, moved: true });
      expect(await read('dark_mode')).not.toBe(was.dark);
      expect(await read('text_size')).toBe(size);
      expect(Object.keys(conditions.read(serial) ?? {}).sort()).toEqual(['dark_mode', 'text_size']);
      await quiet(1_000);
      await picture('device-changed');
      from = sent.length;
      poke({ condition: 'location', value: '41.0082, 28.9784' });
      expect(await answered(from)).toMatchObject({ ok: true });
      if (android) {
        // what only an emulator takes, by the pane's own controls: a call and its end, and a text message
        for (const asked of [
          { condition: 'call', value: '5551234' },
          { clickOn: 'call:end' },
          { condition: 'sms', value: 'Sent from the window' },
        ]) {
          from = sent.length;
          poke(asked);
          expect(await answered(from)).toMatchObject({ ok: true });
        }
      } else {
        for (const name of ['call', 'sms'])
          expect(rows.find((r) => r.name === name)?.why).toMatch(/^A simulator cannot take/);
      }
      from = sent.length;
      // a real click, which brings the row it is on into view
      poke({ clickOn: 'location:clear' });
      expect(await answered(from)).toMatchObject({ ok: true });
      poke({ clickOn: 'sms:send' });
      await quiet(2_000);
      await picture('device-end');
      for (const [i, pane] of PANES.entries()) {
        if (pane === 'device') continue;
        poke({ pane: i });
        await quiet(2_500);
        await picture(pane);
      }
      // a person closes the hub's window: the hub ends only once what the window changed is back
      const closed = Date.now();
      link.send({ op: 'quit' });
      expect(await done).toBe(0);
      const took = Date.now() - closed;
      expect({ dark: await read('dark_mode'), size: await read('text_size') }).toEqual(was);
      expect(conditions.read(serial)).toBeUndefined();
      if (shots)
        appendFileSync(
          join(shots, 'hub-device-times.txt'),
          `${serial} ${look} ${language}: the hub ended ${took} ms after its window closed, both put back\n`,
        );
    },
    FIRST_MS + 4 * 60_000,
  );
});
