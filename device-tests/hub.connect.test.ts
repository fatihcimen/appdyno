import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubServices } from '../packages/appdyno/src/hub-services.js';
import { CLIENTS } from '../packages/cli/src/index.js';
import {
  viewerBinary,
  ViewerProcess,
  type DeviceProvider,
  type ListedPhone,
  type ViewerMessage,
} from '../packages/core/src/index.js';
import { androidProvider } from '../packages/driver-android/src/index.js';
import { iphoneProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { untilWithin } from './until.js';

/**
 * Connect a Phone and Tools in the real window, with the real parent and the drivers' real guides. No phone is near it:
 * what one cannot stage stands in by a file a stand-in `ioreg` prints and by what a stand-in driver lists, and each
 * command runs for real in a home of its own. APPDYNO_HUB_CONNECT=1 runs it; APPDYNO_HUB_LOOK and APPDYNO_HUB_LANGUAGE
 * pick how, and APPDYNO_SHOTS keeps pictures there.
 */
const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const shots = process.env.APPDYNO_SHOTS;
const main = join(import.meta.dirname, '../packages/appdyno/dist/main.js');

const usb = (name: string, vendor: number) =>
  `+-o ${name}@1  <class IOUSBHostDevice>\n  "idVendor" = ${vendor}\n  "USB Product Name" = "${name}"\n  "locationID" = 1\n`;
const SAMSUNG = usb('SM-S928B', 0x04e8);
const IPHONE = usb('iPhone', 0x05ac);
const IPHONE_ID = '00001234-0123456789ABCDEF';

describe.runIf(process.env.APPDYNO_HUB_CONNECT)('Connect a Phone and Tools', () => {
  const heard: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  const path = process.env.PATH;
  const sdk = process.env.ANDROID_HOME;
  let home: string;
  let bus: string;
  let link: ViewerProcess;
  let done: Promise<number>;
  /** What the stand-in driver says is connected, as a phone would change it. */
  let phones: ListedPhone[] = [];
  let tools = [{ name: 'adb', ok: true, detail: '' }];

  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = untilWithin(30_000);
  /** The same text a person reads. */
  const words = async () => {
    heard.length = 0;
    link.send({ op: 'snapshot', file: join(home, 'look.png') });
    await until('a look', () => heard.some((m) => m.op === 'snapped'));
    const { parts } = heard.find((m) => m.op === 'snapped')! as unknown as {
      parts: { text: string }[];
    };
    return parts.map((p) => p.text).join('|');
  };
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
  const seeing = async (text: string, ms = 12_000) => {
    const end = Date.now() + ms;
    let said = '';
    while (Date.now() < end) {
      said = await words();
      if (said.includes(text)) return;
      await quiet(200);
    }
    throw new Error(`no "${text}" in: ${said.slice(0, 500)}`);
  };
  const picture = async (name: string) => {
    if (!shots) return;
    await quiet(350);
    heard.length = 0;
    link.send({ op: 'snapshot', file: join(shots, `${name}-${look}-${language}.png`) });
    await until('picture', () => heard.some((m) => m.op === 'snapped'));
  };
  /** The run a click started has ended, and how. */
  const ended = async (name: string, ms = 60_000) => {
    const end = () =>
      sent.find((m) => {
        const run = m.run as { name?: string; code?: number } | undefined;
        return run?.name === name && run.code !== undefined;
      })?.run as { code: number; file?: string } | undefined;
    await until(`${name} to end`, () => end() !== undefined, ms);
    return end()!;
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-hub-connect-'));
    process.env.APPDYNO_STATE_DIR = join(home, 'state');
    // a stand-in adb: nothing here, or any command it spawns, can start or stop the Mac's adb server
    mkdirSync(join(home, 'platform-tools'));
    writeFileSync(join(home, 'platform-tools/adb'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    process.env.ANDROID_HOME = home;
    bus = join(home, 'bus');
    writeFileSync(bus, '');
    // what `ioreg` says is what this file says: nothing is asked of this Mac's real bus
    const stand = join(home, 'ioreg');
    writeFileSync(stand, `#!/bin/sh\ncat "${bus}"\n`);
    chmodSync(stand, 0o755);
    process.env.PATH = `${home}:${path}`;
    const staged = (real: DeviceProvider, mine: (p: ListedPhone) => boolean): DeviceProvider => ({
      ...real,
      list: async () => phones.filter(mine),
      need: async (d) => phones.find((p) => p.serial === d.serial)?.need,
    });
    const providers = [
      staged(androidProvider(), (p) => p.state !== 'usb'),
      staged(iphoneProvider(), (p) => p.state === 'usb'),
    ];
    const binary = await viewerBinary();
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: /^none$/ }, []);
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      services: hubServices({
        home,
        env: { ...process.env, HOME: home },
        mcpCommand: [process.execPath, main, 'mcp'],
        doctor: async () => tools,
        self: [process.execPath, main],
        providers,
        measurements: join(home, 'measurements'),
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
  });

  afterAll(async () => {
    link?.send({ op: 'quit' });
    await done;
    process.env.PATH = path;
    if (sdk === undefined) delete process.env.ANDROID_HOME;
    else process.env.ANDROID_HOME = sdk;
    rmSync(home, { recursive: true, force: true });
  });

  it('stands where nothing else does, and says a cable plainly', async () => {
    await seeing(language === 'tr' ? 'kablo' : 'A cable that only charges');
    await picture('connect-plug');
  });

  it('moves on by itself as a phone changes, and asks only what that phone needs', async () => {
    writeFileSync(bus, SAMSUNG);
    await seeing(language === 'tr' ? 'Yapım numarası' : 'Build number');
    await picture('connect-developer-options');
    await click('stepNext');
    await picture('connect-usb-debugging');
    phones = [{ serial: 'R5C', state: 'unauthorized', ready: false, need: 'not-trusted' }];
    await seeing(language === 'tr' ? 'Her zaman izin ver' : 'Always allow');
    await picture('connect-allow');
    phones = [{ serial: 'R5C', state: 'device', ready: false, need: 'locked' }];
    await seeing(language === 'tr' ? 'kilitli' : 'locked');
    await picture('connect-locked');
  });

  it('takes an iPhone its own way, and never asks it for adb', async () => {
    writeFileSync(bus, IPHONE);
    tools = [{ name: 'adb', ok: false, detail: 'not found' }];
    phones = [
      { serial: IPHONE_ID, state: 'usb', ready: true, model: 'iPhone', need: 'not-trusted' },
    ];
    await seeing(language === 'tr' ? 'Güven' : 'Trust');
    await picture('connect-trust');
    phones = [{ ...phones[0]!, need: 'developer-mode-off' }];
    await seeing(language === 'tr' ? 'yeniden başlar' : 'restarts');
    await picture('connect-developer-mode');
  });

  it('shows Google terms before adb, and only for an Android', async () => {
    phones = [];
    writeFileSync(bus, SAMSUNG);
    await clickRow('Tools');
    await clickRow('Connect a Phone');
    await seeing('adb');
    await picture('connect-get-adb');
    await click('terms');
    expect(sent.some((m) => m.op === 'open')).toBe(false);
  });

  it('runs what a person chooses as the very command, and says how it ended', async () => {
    await clickRow('Tools');
    await picture('tools');
    // a client in this home alone: a real one is never near this
    const client = CLIENTS.find((c) => c.format === 'json' && !c.ownFile)!;
    const file = join(home, client.files[0]!);
    mkdirSync(dirname(file), { recursive: true });
    await click('run:clients-preview');
    expect((await ended('clients-preview')).code).toBe(0);
    expect(existsSync(file)).toBe(false);
    await picture('tools-preview');
    // one button: what showed the lines now adds them
    await click('run:clients-preview');
    expect((await ended('clients')).code).toBe(0);
    expect(readFileSync(file, 'utf8')).toContain('appdyno');
    await click('run:dashboard');
    const page = await ended('dashboard');
    expect(page.code).toBe(0);
    expect(page.file).toMatch(/\.html$/);
    await picture('tools-dashboard');
    await click('run:update-check');
    expect(typeof (await ended('update-check')).code).toBe('number');
  });
});
