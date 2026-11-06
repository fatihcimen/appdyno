import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubPlaces } from '../packages/appdyno/src/hub-places.js';
import { doctor } from '../packages/appdyno/src/doctor.js';
import { deviceProviders } from '../packages/appdyno/src/providers.js';
import {
  viewerBinary,
  ViewerProcess,
  type DeviceProvider,
  type ListedPhone,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { androidProvider } from '../packages/driver-android/src/index.js';
import { DEFAULT_POLICY, runHub, ServerContext } from '../packages/ops/src/index.js';
import { untilWithin } from './until.js';

/**
 * What a phone that gets ready leads to, and every command of Tools for real, on a simulator of the runner's own: its
 * id in APPDYNO_HUB_SIM. It may drive no other device. What a phone says on its way is stood in for; the rest is real.
 */
const sim = process.env.APPDYNO_HUB_SIM;
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
/** Only the pictures: the gate's four rounds of every measure take their time once. */
const short = process.env.APPDYNO_HUB_SHORT !== undefined;
const shots = process.env.APPDYNO_SHOTS;
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const APP = 'com.apple.Preferences';

describe.runIf(sim)('Connect and Tools on a simulator', () => {
  const heard: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  const path = process.env.PATH;
  const sdk = process.env.ANDROID_HOME;
  let home: string;
  let link: ViewerProcess;
  let done: Promise<number>;
  let phones: ListedPhone[] = [];

  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = untilWithin(60_000);
  const click = async (name: string) => {
    heard.length = 0;
    link.send({ op: 'poke', clickOn: name });
    await until(`click on ${name}`, () => heard.some((m) => m.op === 'clicked'));
    expect(heard.find((m) => m.op === 'clicked')).toMatchObject({ found: true, isIt: 1, name });
  };
  const clickRow = async (title: string) => {
    heard.length = 0;
    link.send({ op: 'poke', clickRow: title });
    await until(`row ${title}`, () => heard.some((m) => m.op === 'clicked'));
    expect(heard.find((m) => m.op === 'clicked')).toMatchObject({ found: true });
  };
  const picture = async (name: string) => {
    if (!shots) return;
    await quiet(500);
    heard.length = 0;
    link.send({ op: 'snapshot', file: join(shots, `${name}-${look}-${language}.png`) });
    await until('picture', () => heard.some((m) => m.op === 'snapped'));
  };
  type Run = {
    name?: string;
    code?: number;
    text?: string;
    file?: string;
    stopped?: boolean;
    verdict?: string;
  };
  const runs = (name: string) =>
    sent.map((m) => m.run as Run | undefined).filter((r): r is Run => r?.name === name);
  /** A click, and what the very command said by the time it ended. */
  const ran = async (name: string, ms = 170_000) => {
    const before = runs(name).length;
    await click(`run:${name}`);
    await until(
      `${name} to end`,
      () =>
        runs(name)
          .slice(before)
          .some((r) => r.code !== undefined),
      ms,
    );
    const these = runs(name).slice(before);
    return {
      code: these.at(-1)!.code!,
      said: these.map((r) => r.text ?? '').join(''),
      file: these.at(-1)!.file,
      verdict: these.at(-1)!.verdict,
    };
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-hub-sim-'));
    process.env.APPDYNO_STATE_DIR = join(home, 'state');
    // a stand-in adb: nothing here, or any command it spawns, can start or stop the Mac's adb server
    mkdirSync(join(home, 'platform-tools'));
    writeFileSync(join(home, 'platform-tools/adb'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.ANDROID_HOME = home;
    const stand = join(home, 'ioreg');
    writeFileSync(stand, '#!/bin/sh\n', { mode: 0o755 });
    process.env.PATH = `${home}:${path}`;
    const staged: DeviceProvider = {
      ...androidProvider(),
      handles: () => true,
      list: async () => phones,
      need: async (d) => phones.find((p) => p.serial === d.serial)?.need,
    };
    const only = new RegExp(`^${sim}$`);
    const binary = await viewerBinary();
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: only }, deviceProviders());
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      places: hubPlaces({
        home,
        env: { ...process.env, HOME: home, APPDYNO_ALLOW_DEVICES: `^${sim}$` },
        mcpCommand: [process.execPath, main, 'mcp'],
        doctor: () => doctor({ providers: [] }),
        self: [process.execPath, main],
        providers: [staged],
        measurements: ctx.measurementsDir,
      }),
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          '--not-key',
          ...(language === 'tr' ? ['-AppleLanguages', '(tr)'] : []),
        ]);
        link.onMessage((m) => heard.push(m));
        const send = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          send(m);
        };
        return link;
      },
    });
    await until('the hub', () => sent.some((m) => m.op === 'hub'));
  }, 120_000);

  afterAll(async () => {
    link?.send({ op: 'quit' });
    await done;
    process.env.PATH = path;
    if (sdk === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = sdk;
    rmSync(home, { recursive: true, force: true });
  });

  it('opens a phone that got ready by itself, with what to try', async () => {
    await clickRow('Connect a Phone');
    phones = [{ serial: sim!, state: 'unauthorized', ready: false, need: 'not-trusted' }];
    await until('a look with the phone in it', () =>
      sent.some((m) => (m.connect as { serial?: string } | undefined)?.serial === sim),
    );
    phones = [{ serial: sim!, state: 'device', ready: true, model: 'iPhone 17 Pro' }];
    await until(
      'the phone to open',
      () => sent.some((m) => m.op === 'attach') || heard.some((m) => m.action === 'select'),
    );
    await quiet(6_000);
    await picture('done');
    await click('noteClients');
    await clickRow('Tools');
    // a click is posted: Tools stands when it asks for its apps
    await until('Tools on show', () => heard.some((m) => m.do === 'apps'));
  }, 120_000);

  it.skipIf(short)(
    'saves a baseline and compares with it, each the very command',
    async () => {
      const folder = join(home, 'flows');
      mkdirSync(folder);
      writeFileSync(
        join(folder, 'settings.flow'),
        `app ${APP}\nstop\nlaunch\nwait_for text="General" timeoutMs=15000\n`,
      );
      link.send({ op: 'poke', fill: APP, folder });
      const flows = await ran('flows');
      expect(flows.said, flows.said).toContain('settings');
      expect(flows.code, flows.said).toBe(0);
      const first = await ran('survey', 400_000);
      expect(first.code, first.said).toBe(0);
      const short = await ran('baseline');
      expect(short.said, short.said).toContain('runs a comparison needs');
      await picture('tools-short');
      // three of each, as the gate asks, then a baseline and a compare that can be judged
      for (const n of [2, 3]) {
        const more = await ran('survey', 400_000);
        expect(more.code, `run ${n}: ${more.said}`).toBe(0);
      }
      // a measure that kept too few runs is short of its three, and says so: that is no failure of the row
      const baseline = await ran('baseline');
      if (baseline.code) expect(baseline.said).toContain('runs a comparison needs');
      await ran('survey', 400_000);
      const compare = await ran('compare');
      // on a simulator the gate may fairly call this noisy: what must hold is that the row says what the gate said
      expect(['clear', 'unjudged', 'regression'], compare.said).toContain(compare.verdict);
      await picture('tools-gate');
      const page = await ran('dashboard');
      expect(page.code, page.said).toBe(0);
      expect(page.file).toMatch(/\.html$/);
    },
    1_500_000,
  );

  it('records a timeline and a flight, and Stop saves what it holds', async () => {
    link.send({ op: 'poke', fill: APP });
    const timeline = await ran('timeline', 400_000);
    expect(timeline.code, timeline.said).toBe(0);
    const before = runs('flight').length;
    await click('run:flight');
    await until(
      'the recorder to run',
      () =>
        runs('flight')
          .slice(before)
          .some((r) => r.text),
      60_000,
    );
    await quiet(5_000);
    await click('run:flight');
    await until(
      'the recorder to end',
      () =>
        runs('flight')
          .slice(before)
          .some((r) => r.code !== undefined),
      60_000,
    );
    expect(runs('flight').at(-1)).toMatchObject({ stopped: true });
    await picture('tools-records');
  }, 600_000);
});
