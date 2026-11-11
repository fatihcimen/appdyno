import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppManager } from '@appdyno/core';
import { DeviceError, type Tree, type WireNode } from '@appdyno/protocol';
import { describe, expect, it, vi } from 'vitest';
import { powerControlAt } from '../src/index.js';
import { middle, onDevice, recorded } from './power-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

type Made = Partial<WireNode> & { b: [number, number, number, number] };

/** A screen of one window of `pkg`, made from what that screen shows where none of ours shows it (marked so below). */
const made = (pkg: string, nodes: Made[], size: [number, number] = [1080, 2400]): Tree => ({
  windows: [{ type: 1, pkg, layer: 0, b: [0, 0, ...size], active: true, focused: true }],
  nodes: [
    { p: -1, w: 0, c: 'Application', b: [0, 0, ...size], f: 17 },
    ...nodes.map((n) => ({ p: 0, w: 0, c: 'Button', f: 19, ...n })),
  ],
  truncated: false,
  elapsedMs: 1,
  hash: pkg,
});

const button = (d: string, y: number, more: Partial<WireNode> = {}): Made => ({
  d,
  b: [16, y, 386, y + 50],
  ...more,
});

const IOS_POWER = made(
  'com.apple.springboard',
  [
    { c: 'Slider', d: 'slide to power off', b: [30, 90, 372, 160] },
    { c: 'Slider', d: 'Emergency SOS', b: [30, 600, 372, 670] },
    button('Cancel', 760),
  ],
  [402, 874],
);
const IOS_POWER_TR = made(
  'com.apple.springboard',
  [
    { c: 'Slider', d: 'kapatmak için kaydırın', b: [30, 90, 372, 160] },
    { c: 'Slider', d: 'Acil SOS', b: [30, 600, 372, 670] },
    button('Vazgeç', 760),
  ],
  [402, 874],
);
const IOS_RESET = made(
  'com.apple.Preferences',
  [
    button('General', 60),
    button('Prepare for New iPhone', 200),
    button('Reset', 600),
    button('Erase All Content and Settings', 660),
    button('Reset All Settings', 720),
    button('Erase iPhone', 780),
  ],
  [402, 874],
);
const IOS_RESET_TR = made(
  'com.apple.Preferences',
  [
    button('Genel', 60),
    button('Sıfırla', 600),
    button('Tüm İçerikleri ve Ayarları Sil', 660),
    button('Ağ Ayarlarını Sıfırla', 720),
    button('iPhone’u Sil', 780),
  ],
  [402, 874],
);
const ONE_UI = made('com.android.systemui', [
  button('Power off', 600),
  button('Restart', 700),
  button('Emergency call', 800),
  button('Kapat', 900),
  button('Yeniden başlat', 1000),
  button('Acil arama', 1100),
]);
/** A Xiaomi's power menu, by its words. */
const MIUI = made('com.android.systemui', [button('Reboot', 600), button('Power off', 700)]);
const ONE_UI_RESET = made('com.android.settings', [
  button('Factory data reset', 600),
  button('Delete all', 700),
  button('Fabrika verilerine sıfırla', 800),
  button('Tümünü sil', 900),
  button('Language and input', 1000),
]);
const KEYGUARD = made('com.android.systemui', [
  button('', 2000, { t: 'Emergency call', id: 'com.android.systemui:id/emergency_call_button' }),
  button('', 1000, { t: '1', id: 'com.android.systemui:id/key1' }),
]);
const APP = made('dev.app', [
  button('Restart', 600),
  button('Reset', 700),
  button('Power off', 800),
]);

describe('the system power, emergency and erase controls', () => {
  it.each([
    // the power menu of an API 34 emulator, in English and Turkish: each key, by its words and by its icon
    ['android-power-en', ['Emergency', 'Power off', 'Restart']],
    ['android-power-tr', ['Acil durum', 'Kapat', 'Yeniden başlat']],
    // Settings' erase-all-data screen, and its confirmation
    ['android-erase-en', ['ERASE ALL DATA']],
    ['android-erase-confirm-en', ['ERASE ALL DATA']],
    ['android-erase-tr', ['TÜM VERİLERİ SİL']],
    // what lists Settings' resets, and the quick settings' power menu button
    ['android-reset-options-en', ['Erase all data (factory reset)', 'Reset app preferences']],
    [
      'android-reset-options-tr',
      ['Tüm verileri sil (fabrika ayarlarına sıfırla)', 'Uygulama tercihlerini sıfırla'],
    ],
    ['android-quick-settings-tr', ['Güç menüsü']],
    // Control Center over the fixture on an iPhone with iOS 27.2 in Turkish, a window of the home screen app's in the
    // runner's read: its power button
    ['ios-control-center-tr', ['Güç']],
  ])('are found on %s, by a touch at their x,y', (name, labels) => {
    const tree = recorded(name);
    for (const label of labels)
      expect(powerControlAt(tree, middle(tree, label)), label).toBeDefined();
  });

  it("are found by the power menu's id in any language, the whole dialog, and by the erase screen's", () => {
    const menu = recorded('android-power-en');
    const icon = menu.nodes.filter((n) => n.id === 'android:id/icon')[2];
    expect(powerControlAt(menu, { x: icon?.b[0] ?? 0, y: icon?.b[1] ?? 0 })).toBe('"Restart"');
    expect(powerControlAt(menu, { x: 540, y: 300 })).toBe('the power menu');
    // quick settings' button is named by the words it holds, before its id
    const qs = recorded('android-quick-settings-tr');
    expect(powerControlAt(qs, { x: 930, y: 2270 })).toBe('"Güç menüsü"');
    const wordless = structuredClone(qs);
    for (const n of wordless.nodes) if (n.d === 'Güç menüsü') delete n.d;
    expect(powerControlAt(wordless, { x: 930, y: 2270 })).toBe(
      'the control com.android.systemui:id/pm_lite',
    );
    expect(powerControlAt(recorded('android-erase-tr'), { x: 540, y: 1600 })).toBe(
      "Settings' erase-all-data screen",
    );
  });

  it.each([
    ['iOS slide to power off', IOS_POWER, ['slide to power off', 'Emergency SOS'], ['Cancel']],
    [
      'iOS slide to power off, Turkish',
      IOS_POWER_TR,
      ['kapatmak için kaydırın', 'Acil SOS'],
      ['Vazgeç'],
    ],
    [
      "iOS Settings' Transfer or Reset iPhone",
      IOS_RESET,
      ['Reset', 'Erase All Content and Settings', 'Reset All Settings', 'Erase iPhone'],
      ['General', 'Prepare for New iPhone'],
    ],
    [
      "iOS Settings' Transfer or Reset iPhone, Turkish",
      IOS_RESET_TR,
      ['Sıfırla', 'Tüm İçerikleri ve Ayarları Sil', 'Ağ Ayarlarını Sıfırla', 'iPhone’u Sil'],
      ['Genel'],
    ],
    [
      "Samsung's power menu",
      ONE_UI,
      ['Power off', 'Restart', 'Emergency call', 'Kapat', 'Yeniden başlat', 'Acil arama'],
      [],
    ],
    [
      "Samsung's reset",
      ONE_UI_RESET,
      ['Factory data reset', 'Delete all', 'Fabrika verilerine sıfırla', 'Tümünü sil'],
      ['Language and input'],
    ],
    ["Xiaomi's power menu", MIUI, ['Reboot', 'Power off'], []],
    ['a lock screen', KEYGUARD, ['Emergency call'], ['1']],
  ])('are found on %s (made from its words), and nothing else there', (_, tree, found, not) => {
    for (const label of found)
      expect(powerControlAt(tree, middle(tree, label)), label).toBeDefined();
    for (const label of not)
      expect(powerControlAt(tree, middle(tree, label)), label).toBeUndefined();
  });

  it('are not what leaves those screens, what navigates elsewhere, nor an app of its own words', () => {
    const cases: [string | Tree, string[]][] = [
      ['android-reset-options-en', ['Navigate up']],
      ['android-reset-options-tr', ['Yukarı git']],
      ['android-system-en', ['Navigate up', 'Languages', 'System update']],
      ['ios-general-en', ['About', 'Keyboard']],
      ['ios-control-center-tr', ['Denetim Ekle', 'El Feneri', 'Wi-Fi', 'Parlaklık']],
      [APP, ['Restart', 'Reset', 'Power off']],
    ];
    for (const [screen, labels] of cases) {
      const tree = typeof screen === 'string' ? recorded(screen) : screen;
      for (const label of labels)
        expect(powerControlAt(tree, middle(tree, label)), label).toBeUndefined();
    }
    // the status bar above the erase screen is no part of it
    expect(powerControlAt(recorded('android-erase-en'), { x: 540, y: 30 })).toBeUndefined();
  });
});

const AHEAD =
  "appdyno does not restart, power off, reset or erase a device, nor place a call or call for help: the person does that on the device; press_key back or home leaves this screen; a person allows it ahead in this server's own command line: --allow-power virtual for simulators and emulators, all for every device (APPDYNO_ALLOW_POWER)";

describe('an input on them', () => {
  const restart = middle(recorded('android-power-en'), 'Restart');

  it('is refused where the client cannot ask, by every way a touch is sent, saying appdyno restarts nothing', async () => {
    const tries: [string, Record<string, unknown>][] = [
      ['tap', restart],
      ['tap', { selector: { text: 'Restart' } }],
      ['gesture', { kind: 'long_press', ...restart }],
      ['gesture', { kind: 'double_tap', ...restart }],
      ['gesture', { kind: 'plan', pointers: [[{ ...restart, t: 0 }]] }],
      ['swipe', { direction: 'up', ...restart }],
      ['steps', { steps: [{ action: 'tap', ...restart }] }],
      ['press_key', { key: 'enter' }],
      ['type_text', { text: 'x' }],
    ];
    for (const [tool, args] of tries) {
      const { call, sent } = await onDevice('android-power-en');
      const r = await call(tool, args);
      expect(r.error, tool).toBe(true);
      expect(r.code, tool).toBe('PERMISSION_REQUIRED');
      // steps says which step it stopped at, around the same words
      expect(r.text, tool).toMatch(
        /^PERMISSION_REQUIRED: .* the system's own power, emergency or erase control asks the person first, and this client cannot ask: nothing was done \(no touch was sent\)\n/,
      );
      expect(r.text, tool).toContain(`hint: ${AHEAD}`);
      expect(r.hint, tool).toBe(`${AHEAD}; on the command line, --yes`);
      expect(sent(), tool).toEqual([]);
    }
  });

  it(
    'is refused in a flow replayed, before its step touches anything',
    fakeTimed(async () => {
      const { call, sent } = await onDevice('android-power-en');
      const dir = mkdtempSync(join(tmpdir(), 'appdyno-power-flow-'));
      writeFileSync(join(dir, 'r.flow'), 'tap text="Restart"\n');
      const r = await call('flow', { action: 'run', file: join(dir, 'r.flow') });
      expect(r.error).toBe(true);
      expect(r.text).toContain('asks the person first');
      expect(sent()).toEqual([]);
    }),
  );

  it('is judged on a new read once an input failed after it left, by a tool or a step, as a swipe that opened quick settings', async () => {
    const qs = recorded('android-quick-settings-tr');
    const power = middle(qs, 'Güç menüsü');
    for (const [tool, args] of [
      ['swipe', { direction: 'down' }],
      ['steps', { steps: [{ action: 'swipe', direction: 'down' }] }],
    ] as const) {
      const { call, sent, device } = await onDevice('android-system-en');
      await call('screen', {});
      const act = device.act.bind(device);
      device.act = () => (
        (device.fixture = qs),
        Promise.reject(new DeviceError('TIMEOUT', 'no answer'))
      );
      expect((await call(tool, args)).code, tool).toBe('TIMEOUT');
      device.act = act;
      expect((await call('tap', power)).code, tool).toBe('PERMISSION_REQUIRED');
      expect(sent(), tool).toEqual([]);
    }
  });

  it('leaves the screen by back and home, and reads it, with nothing asked', async () => {
    const { call, sent, asked } = await onDevice('android-power-en', { answer: 'decline' });
    expect((await call('screen', {})).error).toBe(false);
    for (const key of ['back', 'home'])
      expect((await call('press_key', { key })).error, key).toBe(false);
    expect(sent()).toEqual([
      { kind: 'key', key: 'back' },
      { kind: 'key', key: 'home' },
    ]);
    expect(asked).toEqual([]);
  });

  it("goes ahead on the person's yes, asked with the device and what may be lost, and not on a no", async () => {
    const yes = await onDevice('android-power-en', { answer: 'accept' });
    expect((await yes.call('tap', restart)).error).toBe(false);
    expect(yes.asked).toEqual([
      `Let appdyno act on a touch on "Restart", the system's own power, emergency or erase control on Fake Phone (emulator-5580)? The device may power off, restart, place a call, call for help, or lose all it holds.`,
    ]);
    expect(yes.sent()).toEqual([expect.objectContaining({ kind: 'tap' })]);
    for (const answer of ['decline', 'cancel'] as const) {
      const no = await onDevice('android-erase-tr', { answer });
      const r = await no.call('tap', middle(no.tree, 'TÜM VERİLERİ SİL'));
      expect(r.code).toBe('PERMISSION_REQUIRED');
      expect(r.text).toContain('its question got no yes, and nothing was done');
      expect(r.text).not.toMatch(/person declined/);
      expect(r.hint).toBe(
        `a client may answer no by itself, with no person shown the question; ${AHEAD}; ask again only if the person asks for it`,
      );
      expect(no.sent()).toEqual([]);
    }
  });

  it('goes ahead with nothing asked only by --allow-power: virtual on an emulator, all anywhere, and never by --allow-data-loss', async () => {
    for (const o of [
      { policy: { allowPower: 'virtual' as const } },
      { virtual: false, policy: { allowPower: 'all' as const } },
    ]) {
      const { call, sent, asked } = await onDevice('android-power-en', { ...o, answer: 'decline' });
      expect((await call('tap', restart)).error).toBe(false);
      expect(sent()).toHaveLength(1);
      expect(asked).toEqual([]);
    }
    for (const o of [
      { virtual: false, policy: { allowPower: 'virtual' as const } },
      { policy: { allowDataLoss: 'all' as const } },
    ]) {
      const { call, sent } = await onDevice('android-power-en', o);
      expect((await call('tap', restart)).code).toBe('PERMISSION_REQUIRED');
      expect(sent()).toEqual([]);
    }
  });

  it('takes no argument for a yes', async () => {
    const { call, sent } = await onDevice('android-power-en');
    for (const word of ['yes', 'allowPower', 'confirm'])
      expect((await call('tap', { ...restart, [word]: true })).code).toBe('INVALID_ARGUMENT');
    expect(sent()).toEqual([]);
  });

  it('asks at the third press of power in a row, which calls for help on many phones', async () => {
    const { call, sent } = await onDevice('android-system-en');
    expect((await call('press_key', { key: 'power', count: 2 })).error).toBe(false);
    const r = await call('press_key', { key: 'power' });
    expect(r.code).toBe('PERMISSION_REQUIRED');
    expect(r.text).toContain('power pressed 3 times in a row');
    expect(sent()).toHaveLength(2);
  });

  it('is no part of an ordinary screen: a tap there goes as it did', async () => {
    const { call, sent, asked } = await onDevice('android-system-en', { answer: 'decline' });
    const t = recorded('android-system-en');
    expect((await call('tap', middle(t, 'Languages'))).error).toBe(false);
    expect((await call('type_text', { text: 'x' })).error).toBe(false);
    expect(sent().map((a) => (a as { kind?: string }).kind ?? 'typed')).toEqual([
      'tap',
      'typed',
      'key',
    ]);
    expect(asked).toEqual([]);
  });

  it('is judged on the read the touch was aimed by, with no read of its own, in well under a millisecond', async () => {
    const { call, device } = await onDevice('android-system-en');
    const t = recorded('android-system-en');
    await call('screen', {});
    for (const args of [middle(t, 'Languages'), { selector: { text: 'Languages' } }]) {
      const reads = device.calls.filter((c) => c.name === 'tree').length;
      expect((await call('tap', args)).error).toBe(false);
      // a selector reads once to find its element, as it did; a tap by x,y on a fresh read reads nothing
      expect(device.calls.filter((c) => c.name === 'tree').length - reads).toBe(
        'x' in args ? 0 : 1,
      );
      await call('screen', {});
    }
    const qs = recorded('android-quick-settings-tr');
    const started = performance.now();
    for (let i = 0; i < 200; i++) powerControlAt(qs, { x: 540, y: 1200 });
    expect((performance.now() - started) / 200).toBeLessThan(1);
  });
});

describe('a key or typing into a phone app', () => {
  /** The dial pad of an API 34 emulator's Google dialer, its number field holding the focus. */
  const dialer = JSON.parse(
    readFileSync(join(import.meta.dirname, 'fixtures/apps/android-dialer.json'), 'utf8'),
  ) as Tree;

  it('asks the person as a touch there does, as a dial pad takes digits and Enter by keys too', async () => {
    for (const [name, args, how] of [
      ['type_text', { text: '112', submit: true }, 'typing into'],
      ['press_key', { key: 'enter' }, 'the enter key on'],
      ['press_key', { key: '1' }, 'the 1 key on'],
    ] as const) {
      const { call, sent } = await onDevice(dialer);
      const r = await call(name, args);
      expect(r.code, name).toBe('PERMISSION_REQUIRED');
      expect(r.text, name).toContain(
        `${how} the phone app com.google.android.dialer, which may place a call asks the person first`,
      );
      expect(sent(), name).toEqual([]);
    }
  });

  it('asks nothing of a key in an app of no phone, nor of what leaves the dial pad', async () => {
    const { call, sent, asked } = await onDevice(dialer);
    expect((await call('press_key', { key: 'back' })).error).toBe(false);
    const own = await onDevice('android-system-en');
    expect((await own.call('press_key', { key: '1' })).error).toBe(false);
    expect([sent().length, own.sent().length, asked, own.asked]).toEqual([1, 1, [], []]);
  });

  it("asks of a touch in the device's own dialer, which no list here names, asking the device once", async () => {
    // a maker's dialer, as Xiaomi's is its contacts app: the app a call's link opens in
    const { call, sent, device } = await onDevice(made('com.android.contacts', []));
    const opener = vi.fn(() => Promise.resolve('com.android.contacts'));
    device.apps = { opener } as unknown as AppManager;
    for (let i = 0; i < 2; i++)
      expect((await call('tap', { x: 540, y: 1000 })).code).toBe('PERMISSION_REQUIRED');
    expect(opener).toHaveBeenCalledOnce();
    expect(sent()).toEqual([]);
    // with no default dialer the system's chooser answers, which is no phone app
    const none = await onDevice(made('android', []));
    none.device.apps = { opener: () => Promise.resolve('android') } as unknown as AppManager;
    expect((await none.call('tap', { x: 540, y: 1000 })).error).toBe(false);
  });
});
