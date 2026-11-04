import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Point, Tree } from '@appdyno/protocol';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import type { Adb } from '../src/adb.js';
import { AndroidApps } from '../src/apps.js';
import {
  answerInstallPrompts,
  installStep,
  type InstallScreen,
  type InstallStep,
} from '../src/install-consent.js';

/**
 * fixtures/install/*.json are real: agent reads of the prompts on a Xiaomi 25078RA3EY (HyperOS 3, Android 16, tr-TR),
 * with only the prompt's own window's nodes kept. consent and scan came from installing the fixture; warning,
 * warning-details and scan-after-warning from the same fixture built for an old Android (targetSdk 24). samsung-*
 * are the same prompts on a Samsung SM-A525F (One UI 6.1, Android 14, en-US). Where a test changes one, it says
 * "hand-written".
 */
const dir = join(import.meta.dirname, 'fixtures/install');
const real = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as Tree;
/** Hand-written: the recording with some of its words changed by hand, so not a record of any phone. */
const handWritten = (name: string, words: Record<string, string>) => {
  const t = real(name);
  for (const n of t.nodes) if (n.t && words[n.t] !== undefined) n.t = words[n.t];
  return t;
};
const FIXTURE = 'dev.appdyno.fixture';
const app = { id: FIXTURE, names: ['appdyno fixture', FIXTURE] };
const WARNED = "Bu uygulama, Android'in daha eski bir sürümü için geliştirilmiş";
const touch = (s: InstallStep | undefined) => {
  if (!s || !('touch' in s)) throw new Error(`no touch: ${JSON.stringify(s)}`);
  return s;
};
const left = (s: InstallStep | undefined) => {
  if (!s || !('left' in s)) throw new Error(`not left alone: ${JSON.stringify(s)}`);
  return s;
};
const centre = (t: Tree, text: string) => {
  const [l, top, r, b] = t.nodes.find((n) => n.t === text)!.b;
  return { x: Math.round((l + r) / 2), y: Math.round((top + b) / 2) };
};

describe('the USB install prompt', () => {
  it('is known by its ids and takes a touch on accept, not on the button that counts down', () => {
    const t = real('consent');
    const s = touch(installStep(t, app, false));
    expect(s.touch).toEqual(centre(t, 'Yükle'));
    expect(s.touch).not.toEqual(centre(t, 'Reddet (9)'));
    expect(s.said).toContain(`tapped "Yükle" on the phone's USB install prompt for ${FIXTURE}`);
  });

  it('never touches the remember box', () => {
    const t = real('consent');
    const box = t.nodes.find((n) => n.id?.endsWith(':id/do_not_ask_checkbox'))!.b;
    const { x, y } = touch(installStep(t, app, true)).touch;
    expect(x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]).toBe(false);
  });

  it('is left alone when it names another app (hand-written)', () => {
    const t = handWritten('consent', { 'appdyno fixture': 'Another app' });
    const s = left(installStep(t, app, true));
    expect(s.left).toContain('"Another app"');
    expect(s.left).toContain(FIXTURE);
  });

  it('is not recognised when accept counts down, or deny does not (hand-written)', () => {
    const swapped = handWritten('consent', { Yükle: 'Yükle (9)', 'Reddet (9)': 'Reddet' });
    expect(installStep(swapped, app, true)).toBeUndefined();
  });
});

describe("Play Protect's prompt to send the app to Google", () => {
  it.each(['scan', 'scan-after-warning'])(
    'is answered no, with or without the flag: %s',
    (name) => {
      const t = real(name);
      for (const warnings of [false, true]) {
        const s = touch(installStep(t, app, warnings));
        expect(s.touch).toEqual(centre(t, 'Gönderme'));
        expect(s.said).toContain('"Gönderme"');
        expect(s.said).toContain(`${FIXTURE} stayed on this machine`);
      }
    },
  );

  it('is answered no in English, read on a Samsung', () => {
    const t = real('samsung-scan');
    expect(touch(installStep(t, app, false)).touch).toEqual(centre(t, "Don't send"));
  });

  it('in a language it was not seen in is left for a person: no guess can send the app (hand-written)', () => {
    const t = handWritten('scan', {
      'Bilinmeyen uygulamaları her zaman gönder': 'Unbekannte Apps immer senden',
      'Bu seferlik gönder': 'Dieses Mal senden',
      Gönderme: 'Nicht senden',
    });
    for (const warnings of [false, true]) {
      const s = left(installStep(t, app, warnings));
      expect(s.left).toContain('"Nicht senden"');
      expect(s.hint).toContain('do not send');
    }
  });

  it('is left alone when it names another app (hand-written)', () => {
    const t = handWritten('scan', { 'appdyno fixture': 'Another app' });
    expect(left(installStep(t, app, true)).left).toContain('does not name');
  });

  it('is not answered before its buttons are drawn (hand-written)', () => {
    const t = real('scan');
    t.nodes = t.nodes.filter((n) => n.c !== 'android.widget.Button');
    expect(installStep(t, app, true)).toBeUndefined();
  });
});

describe('a Play Protect warning', () => {
  it.each(['warning', 'warning-details'])(
    'is not touched without the flag, and is quoted: %s',
    (name) => {
      const s = left(installStep(real(name), app, false));
      expect(s.left).toContain('Güvenli olmayan uygulama engellendi');
      expect(s.left).toContain(WARNED);
      expect(s.left).toContain(FIXTURE);
      expect(s.hint).toContain('--accept-install-warnings');
      expect(s.hint).toContain('APPDYNO_ACCEPT_INSTALL_WARNINGS=1');
    },
  );

  it('with the flag opens its details, which pass nothing yet', () => {
    const t = real('warning');
    const s = touch(installStep(t, app, true));
    expect(s.touch).toEqual(centre(t, 'Diğer ayrıntılar'));
    expect(s.said).toBeUndefined();
  });

  it('with the flag is passed by its last line, and the answer quotes it with the app', () => {
    const s = touch(installStep(real('warning-details'), app, true));
    // the line "Yine de yükleyin" in the text at [80,945,640,1145], where the screenshot has it
    expect(s.touch.x).toBeGreaterThan(80);
    expect(s.touch.y).toBeGreaterThan(1105);
    expect(s.touch.y).toBeLessThan(1145);
    expect(s.said).toContain(`passed a Play Protect warning for ${FIXTURE}`);
    expect(s.said).toContain('Güvenli olmayan uygulama engellendi');
    expect(s.said).toContain(WARNED);
    expect(s.said).not.toContain('Yine de yükleyin');
  });

  it('that it cannot pass is left for a person even with the flag (hand-written)', () => {
    const t = handWritten('warning', { 'Diğer ayrıntılar': 'Başka bir şey' });
    expect(left(installStep(t, app, true)).hint).toContain('answer it on the phone');
  });

  it("reads the same in English on another maker's phone", () => {
    const quoted = "This app was built for an older version of Android and doesn't include";
    const closed = real('samsung-warning');
    expect(left(installStep(closed, app, false)).left).toContain(quoted);
    expect(touch(installStep(closed, app, true)).touch).toEqual(centre(closed, 'More details'));
    // the line "Install anyway" in the text at [146,1315,934,1551], where the screenshot has it
    const s = touch(installStep(real('samsung-warning-details'), app, true));
    expect(s.touch.x).toBeGreaterThan(146);
    expect(s.touch.y).toBeGreaterThan(1490);
    expect(s.touch.y).toBeLessThan(1551);
    expect(s.said).toContain(quoted);
    expect(s.said).not.toContain('Install anyway');
  });
});

const CONSENT_WINDOW =
  'Window{1 u0 com.miui.securitycenter/com.miui.permcenter.install.AdbInstallActivity}';
const PROTECT_WINDOW =
  'Window{2 u0 com.android.vending/com.google.android.finsky.protectdialogs.activity.PlayProtectDialogsActivity}';
const APK = join(dir, 'plain.apk');
const names = vi.fn(async () => app);

/** A phone that shows these screens in turn: each touch moves to the next, unless it ignores touches. */
function phone(
  screens: { focus: string; tree?: Tree }[],
  o: { ignores?: boolean; adbInput?: string; opensLater?: boolean } = {},
) {
  let at = 0;
  let looks = 0;
  const presses: Point[] = [];
  const s: InstallScreen & { presses: Point[]; ended: () => boolean } = {
    presses,
    ended: () => at >= screens.length,
    currentFocus: async () =>
      (o.opensLater && looks++ === 0 ? undefined : screens[at]?.focus) ?? 'Window{0 u0 launcher}',
    focusSteady: async () => undefined,
    ensureAwake: vi.fn(async () => {
      if (screens[at]?.focus === '') at++;
    }),
    tree: async () => screens[at]?.tree ?? real('consent'),
    press: async (p) => {
      presses.push(p);
      if (!o.ignores) at++;
    },
    shell: async () => o.adbInput ?? '0',
  };
  return s;
}

describe('answering during an install', () => {
  // the watcher's waits are real time, of no interest here
  const fast = async (run: () => Promise<void>) => {
    vi.useFakeTimers();
    try {
      const done = run();
      await vi.runAllTimersAsync();
      await done;
    } finally {
      vi.useRealTimers();
    }
  };
  const until = (s: ReturnType<typeof phone>) => () => !s.ended();

  it('answers no to the scan, then yes to the consent, and says both', async () => {
    const s = phone([
      { focus: PROTECT_WINDOW, tree: real('scan') },
      { focus: CONSENT_WINDOW, tree: real('consent') },
    ]);
    const said: string[] = [];
    await fast(() => answerInstallPrompts(s, names, false, until(s), said));
    expect(s.presses).toEqual([centre(real('scan'), 'Gönderme'), centre(real('consent'), 'Yükle')]);
    expect(said.join('\n')).toContain('stayed on this machine');
    expect(said.join('\n')).toContain('tapped "Yükle"');
  });

  it('with the flag goes all the way past a warning, as on the phone', async () => {
    const s = phone([
      { focus: PROTECT_WINDOW, tree: real('warning') },
      { focus: PROTECT_WINDOW, tree: real('warning-details') },
      { focus: PROTECT_WINDOW, tree: real('scan-after-warning') },
      { focus: CONSENT_WINDOW, tree: real('consent') },
    ]);
    const said: string[] = [];
    await fast(() => answerInstallPrompts(s, names, true, until(s), said));
    expect(s.presses).toHaveLength(4);
    expect(said).toHaveLength(3);
    expect(said[0]).toContain('passed a Play Protect warning');
  });

  it('without the flag refuses at the warning, with no touch', async () => {
    const s = phone([{ focus: PROTECT_WINDOW, tree: real('warning') }]);
    const said: string[] = [];
    let e: unknown;
    await fast(() =>
      answerInstallPrompts(s, names, false, until(s), said).catch((x: unknown) => void (e = x)),
    );
    expect(s.presses).toEqual([]);
    expect((e as DeviceError).code).toBe('PERMISSION_REQUIRED');
    expect((e as DeviceError).message).toContain('Güvenli olmayan');
  });

  it('touches only once the prompt has stopped sliding', async () => {
    const reads = [real('consent-sliding'), real('consent-sliding'), real('consent')];
    reads[1]!.windows[1]!.b = [22, 1203, 698, 1736];
    const s = phone([{ focus: CONSENT_WINDOW }]);
    let i = 0;
    s.tree = async () => reads[Math.min(i++, reads.length - 1)]!;
    const said: string[] = [];
    await fast(() => answerInstallPrompts(s, names, false, until(s), said));
    // two reads of the same place came after the slide
    expect(i).toBeGreaterThanOrEqual(4);
    expect(s.presses).toEqual([centre(real('consent'), 'Yükle')]);
  });

  it('wakes a screen that went dark while the install is pending', async () => {
    const s = phone([{ focus: '' }, { focus: CONSENT_WINDOW, tree: real('consent') }]);
    await fast(() => answerInstallPrompts(s, names, false, until(s), []));
    expect(s.ensureAwake).toHaveBeenCalled();
    expect(s.presses).toHaveLength(1);
  });

  it('says so when touches are ignored, and names the setting it does not change', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }], { ignores: true });
    let e: unknown;
    await fast(() =>
      answerInstallPrompts(s, names, false, () => true, []).catch((x: unknown) => void (e = x)),
    );
    expect(s.presses).toHaveLength(3);
    expect((e as DeviceError).message).toContain('ignored 3 touches');
    expect((e as DeviceError).hint).toContain('turn on "USB debugging (Security settings)"');
  });

  it('with that setting already on does not send a person to it', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }], {
      ignores: true,
      adbInput: '1\n',
    });
    let e: unknown;
    await fast(() =>
      answerInstallPrompts(s, names, false, () => true, []).catch((x: unknown) => void (e = x)),
    );
    expect((e as DeviceError).hint).toContain('already reads on');
  });

  it('passes on the refusal of injected input', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }]);
    const refusal = new DeviceError(
      'PERMISSION_REQUIRED',
      'the device refuses injected input',
      'USB debugging (Security settings)',
    );
    s.press = async () => Promise.reject(refusal);
    let e: unknown;
    await fast(() =>
      answerInstallPrompts(s, names, false, () => true, []).catch((x: unknown) => void (e = x)),
    );
    expect(e).toBe(refusal);
  });

  it('other trouble leaves the install alone and is said', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }]);
    s.tree = async () => Promise.reject(new DeviceError('AGENT_CONFLICT', 'another tool holds it'));
    const said: string[] = [];
    let polls = 0;
    await fast(() => answerInstallPrompts(s, names, false, () => polls++ < 3, said));
    expect(s.presses).toEqual([]);
    expect(said).toEqual(["could not answer the phone's prompt: another tool holds it"]);
  });

  it('a finger-up refused once does not cost the answer its line', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }]);
    const press = s.press;
    let tries = 0;
    s.press = async (p, ms) => {
      if (++tries === 1) throw new DeviceError('INTERNAL', 'the input event was not delivered');
      return press(p, ms);
    };
    const said: string[] = [];
    await fast(() => answerInstallPrompts(s, names, false, until(s), said));
    expect(tries).toBe(2);
    expect(said).toEqual([`tapped "Yükle" on the phone's USB install prompt for ${FIXTURE}`]);
  });

  it('does not read the file before a prompt shows', async () => {
    const s = phone([{ focus: 'Window{0 u0 launcher}' }]);
    const read = vi.fn(async () => app);
    let polls = 0;
    await fast(() => answerInstallPrompts(s, read, false, () => polls++ < 3, []));
    expect(read).not.toHaveBeenCalled();
    expect(s.presses).toEqual([]);
  });

  it('touches nothing when the file cannot say what it is', async () => {
    const s = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }]);
    const unread = async () => Promise.reject(new Error('no package in its manifest'));
    let e: unknown;
    await fast(() =>
      answerInstallPrompts(s, unread, false, until(s), []).catch((x: unknown) => void (e = x)),
    );
    expect(s.presses).toEqual([]);
    expect((e as DeviceError).message).toContain('no package in its manifest');
  });
});

describe('install', () => {
  const adb = (run: (stop?: AbortSignal) => Promise<string>) =>
    ({
      exec: async () => '',
      run: (_a: string[], _ms: number, stop?: AbortSignal) => run(stop),
    }) as unknown as Adb;
  const restricted = () =>
    Promise.reject(new Error('Failure [INSTALL_FAILED_USER_RESTRICTED: Install canceled by user]'));

  it('with the setting off leaves the screen alone and answers as before', async () => {
    const screen = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }]);
    const apps = new AndroidApps(adb(restricted), 'phone', screen, {
      prompts: false,
      warnings: true,
    });
    const e = await apps.install(APK).catch((x: DeviceError) => x);
    expect(screen.presses).toEqual([]);
    expect((e as DeviceError).message).toBe(
      'the phone asked on its screen whether to install over USB, and no one said yes in time',
    );
    expect((e as DeviceError).hint).toContain('within 10 s');
  });

  it("refuses a prompt already open: it is an earlier install's, and nothing is touched or started", async () => {
    const screen = phone([{ focus: PROTECT_WINDOW, tree: real('warning') }]);
    const run = vi.fn(async () => 'Success');
    const apps = new AndroidApps(adb(run), 'phone', screen, { prompts: true, warnings: true });
    const e = await apps.install(APK).catch((x: DeviceError) => x);
    expect((e as DeviceError).message).toContain('from before this install');
    expect(run).not.toHaveBeenCalled();
    expect(screen.presses).toEqual([]);
  });

  it('says so when the phone says no to a prompt it tapped, and names the setting', async () => {
    const screen = phone([{ focus: CONSENT_WINDOW, tree: real('consent') }], { opensLater: true });
    // the prompt said no a moment after the touch
    const refused = () => new Promise<void>((r) => setTimeout(r, 2_500)).then(restricted);
    const e = await new AndroidApps(adb(refused), 'phone', screen)
      .install(APK)
      .catch((x: DeviceError) => x);
    expect(screen.presses).toHaveLength(1);
    expect((e as DeviceError).message).toContain('though its prompt was tapped');
    expect((e as DeviceError).message).toContain('tapped "Yükle"');
    expect((e as DeviceError).hint).toContain('USB debugging (Security settings)');
  });

  it('returns at once where no prompt comes, and says nothing', async () => {
    const screen = phone([{ focus: 'Window{0 u0 launcher}' }]);
    const apps = new AndroidApps(
      adb(async () => 'Success'),
      'emulator-5680',
      screen,
    );
    expect(await apps.install(APK)).toEqual([]);
    expect(screen.presses).toEqual([]);
  });

  it('ends the pending adb when a person must answer', async () => {
    const screen = phone([{ focus: PROTECT_WINDOW, tree: real('warning') }], { opensLater: true });
    let stopped = false;
    const pending = (stop?: AbortSignal) =>
      new Promise<string>((_, no) =>
        stop?.addEventListener('abort', () => {
          stopped = true;
          no(new Error('adb killed'));
        }),
      );
    const e = await new AndroidApps(adb(pending), 'phone', screen)
      .install(APK)
      .catch((x: DeviceError) => x);
    expect(stopped).toBe(true);
    expect((e as DeviceError).code).toBe('PERMISSION_REQUIRED');
    expect((e as DeviceError).hint).toContain('--accept-install-warnings');
  });
});
