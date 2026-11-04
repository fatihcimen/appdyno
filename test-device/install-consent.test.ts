import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';
import { checkedOps } from '../packages/ops/test/helpers.js';
import {
  Adb,
  AndroidDevice,
  androidProvider,
  apkNames,
  FOCUS_READ,
  stats,
  type InstallAnswers,
} from 'appdyno';
import { opCaller } from './helpers.js';

/**
 * `app install` and the phone's own prompts, with no person: APPDYNO_ANDROID_SERIAL names the device. On a phone that
 * asks (a Xiaomi with its USB install prompt) it installs with no one there; where nothing asks, as on an emulator, it
 * installs as before. Play Protect is a prompt of its own, the same on any maker's phone, and comes only with "Verify
 * apps over USB" on (`settings get global verifier_verify_adb_installs` reads 1). APPDYNO_WARNED_APK is an app it warns
 * about, such as the fixture built with `./gradlew :fixture:assembleDebug -PoldTarget` and copied somewhere: without it
 * the warning's tests are skipped. APPDYNO_UNSEEN_APK is an app it has not seen, as its prompt to send an app comes only
 * for some: without it that test is skipped.
 */
const serial = process.env.APPDYNO_ANDROID_SERIAL;
const WARNED_APK = process.env.APPDYNO_WARNED_APK;
const UNSEEN_APK = process.env.APPDYNO_UNSEEN_APK;
const ROUNDS = Number(process.env.APPDYNO_INSTALL_ROUNDS ?? 5);
const APP = 'dev.appdyno.fixture';
const WARNED_APP = WARNED_APK ? (await apkNames(WARNED_APK)).id : '';
const UNSEEN_APP = UNSEEN_APK ? (await apkNames(UNSEEN_APK)).id : '';
const APK = join(
  import.meta.dirname,
  '../android/fixture/build/outputs/apk/debug/fixture-debug.apk',
);
const adb = new Adb();
const sh = (c: string, s = serial!) =>
  execFileSync(adb.bin, ['-s', s, 'shell', c], { encoding: 'utf8' }).trim();
const asks = !!serial && sh('getprop persist.security.adbinstall') === '1';
const verifies = !!serial && sh('settings get global verifier_verify_adb_installs') === '1';
const installed = (app: string) => sh(`pm path ${app} 2>&1; true`).includes('package:');
const gone = (app: string) => sh(`pm uninstall ${app} >/dev/null 2>&1; true`);
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const focus = () => sh(FOCUS_READ);
const PROTECT = /PlayProtectDialogsActivity/;
const CONSENT = /AdbInstallActivity/;

function harness(installAnswers: InstallAnswers) {
  const ctx = new ServerContext(DEFAULT_POLICY, [androidProvider(new Adb(), { installAnswers })], {
    device: serial!,
    app: APP,
    claims: true,
  });
  return { ctx, call: opCaller(checkedOps(ctx)) };
}
const off = { prompts: false, warnings: false };
const on = { prompts: true, warnings: false };
const withWarnings = { prompts: true, warnings: true };

let open: ReturnType<typeof harness>[] = [];
const started = (a: InstallAnswers) => {
  const h = harness(a);
  open.push(h);
  return h;
};
/** What a person does at the phone: this suite's own touch, for what the tool must leave alone. */
const person = async (h: ReturnType<typeof harness>, words: RegExp) => {
  const { device } = await h.ctx.session();
  const t = await device.tree();
  const n = t.nodes.find((x) => x.t && words.test(x.t));
  if (!n) return false;
  const [l, top, r, b] = n.b;
  await device.longPress({ x: (l + r) / 2, y: (top + b) / 2 }, 150, { settle: false });
  return true;
};

afterEach(async () => {
  for (const h of open) {
    await h.ctx.end().catch(() => []);
    h.ctx.close();
  }
  open = [];
});

describe.skipIf(!asks)('a phone that asks before an install', () => {
  afterAll(async () => {
    // the fixture goes back on the phone, whatever failed
    if (!installed(APP)) await started(on).call('app', { action: 'install', path: APK });
    for (const h of open) h.ctx.close();
    expect(installed(APP)).toBe(true);
  }, 120_000);

  it(
    `installs with no person, ${ROUNDS} times in a row, and says it tapped`,
    async () => {
      const rounds: { ok: boolean; ms: number; text: string }[] = [];
      for (let i = 0; i < ROUNDS; i++) {
        gone(APP);
        const { call } = started(on);
        const t = Date.now();
        const r = await call('app', { action: 'install', path: APK });
        rounds.push({
          ok: !r.error && /^tapped "/m.test(r.text) && installed(APP),
          ms: Date.now() - t,
          text: r.text,
        });
      }
      console.log(
        rounds
          .map((r, i) => `${i + 1}: ${r.ok ? 'ok' : 'FAILED'} ${r.ms} ms\n${r.text}`)
          .join('\n'),
      );
      expect(rounds.filter((r) => r.ok)).toHaveLength(ROUNDS);
    },
    120_000 * ROUNDS,
  );

  it('keeps what it tapped in the report', async () => {
    gone(APP);
    const { call } = started(on);
    const dir = join(mkdtempSync(join(tmpdir(), 'appdyno-install-')), 'report');
    await call('report', { action: 'start', dir });
    const r = await call('app', { action: 'install', path: APK });
    expect(r.error).toBe(false);
    await call('report', { action: 'stop' });
    expect(readFileSync(join(dir, 'steps.jsonl'), 'utf8')).toContain('USB install prompt');
  });

  it('with no agent running starts one in time', async () => {
    gone(APP);
    await new AndroidDevice(serial!, new Adb()).stopAgent();
    const r = await started(on).call('app', { action: 'install', path: APK });
    expect(r.text).toMatch(/^tapped "/m);
    expect(installed(APP)).toBe(true);
  });

  it('wakes a screen that goes dark as the prompt opens', async () => {
    gone(APP);
    const installing = started(on).call('app', { action: 'install', path: APK });
    let slept = false;
    const dark = (async () => {
      for (let i = 0; i < 200 && !slept; i++) {
        if (CONSENT.test(focus())) {
          sh('input keyevent KEYCODE_SLEEP');
          slept = true;
        } else await pause(50);
      }
    })();
    const r = await installing;
    await dark;
    console.log(`slept: ${slept}\n${r.text}`);
    expect(r.text).toMatch(/^tapped "/m);
    expect(installed(APP)).toBe(true);
  }, 120_000);

  it('with the setting off leaves the prompt alone and answers as before', async () => {
    gone(APP);
    const h = started(off);
    const installing = h.call('app', { action: 'install', path: APK });
    let done = false;
    void installing.then(() => (done = true));
    let asked = false;
    while (!done) {
      const f = focus();
      asked ||= CONSENT.test(f);
      // the tool leaves it, so a person answers the prompt that comes before the one under test
      if (PROTECT.test(f)) await person(h, /^(Gönderme|Don't send)$/);
      await pause(300);
    }
    const r = await installing;
    expect(asked).toBe(true);
    expect(r.data.code).toBe('PERMISSION_REQUIRED');
    expect(r.text).toContain(
      'the phone asked on its screen whether to install over USB, and no one said yes in time',
    );
    expect(r.text).not.toContain('tapped');
    expect(installed(APP)).toBe(false);
  }, 120_000);
});

describe.skipIf(!verifies)('Play Protect on a USB install', () => {
  afterAll(() => {
    if (WARNED_APK) gone(WARNED_APP);
  });

  it.skipIf(!UNSEEN_APK)(
    'answers no when asked to send the app to Google',
    async () => {
      gone(UNSEEN_APP);
      const r = await started(on).call('app', { action: 'install', path: UNSEEN_APK! });
      console.log(r.text);
      expect(r.text).toMatch(/^answered ".+" to Play Protect's prompt .+ stayed on this machine$/m);
      if (asks) expect(r.text).toMatch(/^tapped "/m);
      expect(installed(UNSEEN_APP)).toBe(true);
    },
    120_000,
  );

  describe.skipIf(!WARNED_APK || !existsSync(WARNED_APK))('and a warning', () => {
    it('is left alone without the flag, and quoted, and waits for a person', async () => {
      gone(WARNED_APP);
      const h = started(on);
      const r = await h.call('app', { action: 'install', path: WARNED_APK! });
      console.log(r.text);
      expect(r.data.code).toBe('PERMISSION_REQUIRED');
      expect(r.text).toContain(`Play Protect warned about ${WARNED_APP}`);
      expect(r.text).toContain('--accept-install-warnings');
      expect(PROTECT.test(focus())).toBe(true);
      expect(installed(WARNED_APP)).toBe(false);
      // the next install is another call's: that old prompt is not its to touch, even with the flag
      const again = await started(withWarnings).call('app', {
        action: 'install',
        path: WARNED_APK!,
      });
      expect(again.text).toContain('from before this install');
      expect(PROTECT.test(focus())).toBe(true);
      // a person says no
      expect(await person(h, /^(Anladım|Got it)$/)).toBe(true);
      for (let i = 0; i < 20 && PROTECT.test(focus()); i++) await pause(250);
      expect(PROTECT.test(focus())).toBe(false);
      expect(installed(WARNED_APP)).toBe(false);
    }, 120_000);

    it('is passed with the flag, and quoted with the app, in the report too', async () => {
      gone(WARNED_APP);
      const { call } = started(withWarnings);
      const dir = join(mkdtempSync(join(tmpdir(), 'appdyno-install-')), 'report');
      await call('report', { action: 'start', dir });
      const r = await call('app', { action: 'install', path: WARNED_APK! });
      await call('report', { action: 'stop' });
      console.log(r.text);
      expect(r.error).toBe(false);
      expect(r.text).toContain(`passed a Play Protect warning for ${WARNED_APP}: "`);
      expect(installed(WARNED_APP)).toBe(true);
      expect(readFileSync(join(dir, 'steps.jsonl'), 'utf8')).toContain(
        'passed a Play Protect warning',
      );
    }, 120_000);
  });
});

describe.skipIf(!serial || asks)('a device where nothing asks', () => {
  beforeAll(() => {
    expect(existsSync(APK)).toBe(true);
  });

  it('installs as before, with no wait worth noticing', async () => {
    const times = async (a: InstallAnswers) => {
      const ms: number[] = [];
      for (let i = 0; i < 3; i++) {
        const { ctx, call } = harness(a);
        const t = Date.now();
        const r = await call('app', { action: 'install', path: APK });
        ms.push(Date.now() - t);
        expect(r.text).toBe(`installed ${APK}`);
        ctx.close();
      }
      return stats(ms, 0).p50;
    };
    // the first install of a run does more: off, then on, each the same
    await times(off);
    const [was, now] = [await times(off), await times(on)];
    console.log(`install p50: setting off ${was} ms, on ${now} ms`);
    expect(now - was).toBeLessThan(1_000);
  }, 300_000);
});
