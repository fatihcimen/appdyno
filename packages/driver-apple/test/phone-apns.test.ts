import { generateKeyPairSync } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { Devicectl } from '../src/devicectl.js';
import { keepApnsKey } from '../src/apns-key.js';
import { apsEnvironment, PhoneApnsTarget, readBuild } from '../src/phone-apns.js';
import { PhoneEvents } from '../src/phone-manage.js';

const DEVICE = 'ab'.repeat(32);

/** devicectl following a relaunched app's console: what it prints, as it prints it. */
function console_() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    exitCode: null as number | null,
    kill: vi.fn(),
  });
  return child;
}

describe("an iPhone's app, to APNs", () => {
  it("is a distribution build by its signature's production aps-environment, a development one by development", () => {
    const signed = (env: string) =>
      `<plist><dict><key>aps-environment</key>\n<string>${env}</string></dict></plist>`;
    expect(apsEnvironment(signed('production'))).toBe('production');
    expect(apsEnvironment(signed('development'))).toBe('development');
    expect(apsEnvironment('<plist><dict/></plist>')).toBeUndefined();
  });

  it('read from a build before it is installed: its id, whether it declares VoIP, and no environment unsigned', async () => {
    const app = join(mkdtempSync(join(tmpdir(), 'appdyno-build-')), 'App.app');
    mkdirSync(app);
    writeFileSync(
      join(app, 'Info.plist'),
      `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>dev.app</string><key>UIBackgroundModes</key><array><string>voip</string></array></dict></plist>`,
    );
    expect(await readBuild(app)).toEqual(['dev.app', { voip: true }]);
  });

  it('has its token read once it is relaunched with its console followed, and then from the same console', async () => {
    const child = console_();
    const follow = vi.fn(() => child as never);
    const target = new PhoneApnsTarget({ udid: 'U' } as Devicectl, new Map(), follow);
    const first = target.lines('dev.app', 'device');
    child.stdout.write('starting\n');
    child.stderr.write(`device token: ${DEVICE}\n`);
    expect(await first).toEqual({
      lines: ['starting', `device token: ${DEVICE}`],
      relaunched: true,
    });
    child.stdout.write(`Live Activity token ${DEVICE}\n`);
    await new Promise((r) => setImmediate(r));
    const again = await target.lines('dev.app', 'activity');
    expect(again).toEqual({
      lines: expect.arrayContaining([`Live Activity token ${DEVICE}`]) as unknown,
    });
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow).toHaveBeenCalledWith('U', 'dev.app');
  });

  it('follows one console of an app however many ask while it starts', async () => {
    const child = console_();
    // a console that starts a moment later, as one does once Xcode's first launch is asked
    const follow = vi.fn(() => Promise.resolve(child as never));
    const target = new PhoneApnsTarget({ udid: 'U' } as Devicectl, new Map(), follow);
    const first = target.lines('dev.app', 'device');
    expect(await target.lines('dev.app', 'device')).toEqual({ lines: [] });
    await new Promise((r) => setImmediate(r));
    child.stderr.write(`device token: ${DEVICE}\n`);
    expect(await first).toMatchObject({ relaunched: true });
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it("keeps the newest 5,000 of a console's lines, however much the app says", async () => {
    const child = console_();
    const target = new PhoneApnsTarget({ udid: 'U' } as Devicectl, new Map(), () => child as never);
    const read = target.lines('dev.app', 'device');
    child.stdout.write(
      `${Array.from({ length: 6_000 }, (_, i) => `line ${i}`).join('\n')}\ntoken ${DEVICE}\n`,
    );
    const { lines } = await read;
    expect(lines).toHaveLength(5_000);
    expect(lines.at(-1)).toBe(`token ${DEVICE}`);
  });

  it('lets go of the console by SIGKILL, which devicectl cannot hand on to the app', async () => {
    const child = console_();
    const target = new PhoneApnsTarget({ udid: 'U' } as Devicectl, new Map(), () => child as never);
    const read = target.lines('dev.app', 'device');
    child.stdout.write(`token ${DEVICE}\n`);
    await read;
    target.close();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('is a known build only when this tool installed it', async () => {
    const builds = new Map([['dev.app', { build: 'distribution' as const, voip: false }]]);
    const target = new PhoneApnsTarget({ udid: 'U' } as Devicectl, builds);
    expect(await target.build('dev.app')).toBe('distribution');
    expect(await target.build('dev.other')).toBeUndefined();
    expect(await target.declaresVoip('dev.other')).toBeUndefined();
  });
});

describe("an iPhone's push types", () => {
  it('are refused, saying how, until a person sets APNs up; then go by APNs, but for a tap', async () => {
    const events = new PhoneEvents({ udid: 'U' } as Devicectl, new Map());
    const said = async () =>
      Object.fromEntries(
        (await events.pushRoutes()).map((r) => [r.type, 'route' in r ? r.route : r.why]),
      );
    expect(new Set(Object.values(await said()))).toEqual(
      new Set([
        expect.stringContaining('once a person sets APNs up with `appdyno push setup apns`'),
      ]),
    );
    const key = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).privateKey;
    keepApnsKey({
      key: key.export({ type: 'pkcs8', format: 'pem' }) as string,
      keyId: 'ABC123DEFG',
      teamId: 'DEF123GHIJ',
      production: true,
    });
    const routes = await said();
    expect(routes.alert).toMatch(
      /^APNs, its sandbox, or production for a distribution build, by the device token/,
    );
    expect(routes.widgets).toContain('by the widget token');
    expect(routes.tapped).toContain('nothing taps a push on an iPhone but a person');
    await expect(events.push('dev.app', { type: 'tapped' })).rejects.toThrow(
      'nothing taps a push on an iPhone but a person',
    );
    events.close();
    vi.unstubAllEnvs();
  });
});
