import type { ListedPhone as Listed, UsbPhone } from '@appdyno/core';
import { describe, expect, it } from 'vitest';
import { androidProvider } from '@appdyno/driver-android';
import { appleProvider } from '@appdyno/driver-apple';
import { guideFor as guideOf, listedPhones, runnerChecks, type Guide } from '../src/hub-connect.js';

const all = () => true;
const drivers = [androidProvider(), appleProvider()];
const guideFor = (o: Parameters<typeof guideOf>[1]) => guideOf(drivers, o);
const samsung: UsbPhone = { maker: 'samsung', name: 'SM-S928B' };
const xiaomi: UsbPhone = { maker: 'xiaomi', name: 'REDMI 15C' };
const iphone: UsbPhone = { maker: 'apple', name: 'iPhone' };
const android = (o: Partial<Listed> = {}): Listed => ({
  serial: 'R5C',
  state: 'device',
  ready: true,
  ...o,
});
const apple = (o: Partial<Listed> = {}): Listed => ({
  serial: '00001234-0123456789ABCDEF',
  state: 'usb',
  ready: true,
  ...o,
});

/** The first step left, as a person sees it. */
const now = (g: Guide) => g.steps.find((s) => !s.done)?.id;
const ids = (g: Guide) => g.steps.map((s) => s.id);

describe('the phone in a person hand', () => {
  it('has nothing to say of a bus with no phone, which is the cable or the phone itself', () => {
    expect(guideFor({ usb: [], phones: [], has: all })).toEqual({ steps: [], ready: false });
  });

  it('asks for adb only of one with an Android, and starts with it', () => {
    const none = (tool: string) => tool !== 'adb';
    const g = guideFor({ usb: [samsung], phones: [], has: none });
    expect(now(g)).toBe('get-adb');
    expect(guideFor({ usb: [iphone], phones: [], has: none }).steps.map((s) => s.id)).not.toContain(
      'get-adb',
    );
  });

  it('asks for Xcode only of one with an iPhone', () => {
    const none = (tool: string) => tool !== 'xcode';
    expect(now(guideFor({ usb: [iphone], phones: [], has: none }))).toBe('get-xcode');
    expect(ids(guideFor({ usb: [samsung], phones: [], has: none }))).not.toContain('get-xcode');
  });
});

describe('an Android, step by step as it changes by itself', () => {
  it('begins at Developer options while adb has not heard of it, which the Mac cannot see past', () => {
    const g = guideFor({ usb: [samsung], phones: [], has: all });
    expect(g.hand).toBe('android');
    expect(g.maker).toBe('samsung');
    expect(now(g)).toBe('developer-options');
    expect(g.steps[0]!.sees).toBe(false);
    expect(g.ready).toBe(false);
  });

  it('goes on to Allow when adb hears of it and the phone has not said yes', () => {
    const phones = [android({ state: 'unauthorized', ready: false, need: 'not-trusted' })];
    const g = guideFor({ usb: [samsung], phones, has: all });
    expect(now(g)).toBe('allow');
    expect(g.need).toBeUndefined();
  });

  it('is ready when the phone said yes', () => {
    const g = guideFor({ usb: [samsung], phones: [android()], has: all });
    expect(now(g)).toBeUndefined();
    expect(g.ready).toBe(true);
    expect(g.serial).toBe('R5C');
  });

  it('says a lock it read, and calls no locked phone ready', () => {
    const g = guideFor({ usb: [samsung], phones: [android({ need: 'locked' })], has: all });
    expect(g.need).toBe('locked');
    expect(g.ready).toBe(false);
  });

  it('asks nothing of a Xiaomi that a phone of another maker has not got', () => {
    expect(ids(guideFor({ usb: [samsung], phones: [android()], has: all }))).not.toContain(
      'xiaomi-security',
    );
  });

  it('ticks each of a Xiaomi switches by what the phone reads, and neither holds the phone up', () => {
    const on = { input: '1', install: '0' };
    const g = guideFor({ usb: [xiaomi], phones: [android({ switches: on })], has: all });
    expect(now(g)).toBe('xiaomi-install');
    expect(g.ready).toBe(true);
    expect(g.steps.find((s) => s.id === 'xiaomi-install')!.sees).toBe(false);
  });

  it('knows a Xiaomi with neither switch read, as a phone may not say', () => {
    const g = guideFor({ usb: [xiaomi], phones: [android()], has: all });
    expect(now(g)).toBe('xiaomi-security');
  });
});

describe('an iPhone, step by step', () => {
  const on = (need?: Listed['need']) =>
    guideFor({ usb: [iphone], phones: [apple(need ? { need } : {})], has: all });

  it('needs Trust before all, for a phone a driver has not heard of too', () => {
    expect(now(guideFor({ usb: [iphone], phones: [], has: all }))).toBe('trust');
    expect(now(on('not-trusted'))).toBe('trust');
    expect(on('not-trusted').need).toBeUndefined();
  });

  it('then Developer Mode, and it stands apart from what is said', () => {
    expect(now(on('developer-mode-off'))).toBe('developer-mode');
    expect(on('developer-mode-off').need).toBeUndefined();
  });

  it('says a lock, and an OS too old for a runner', () => {
    expect(on('locked').need).toBe('locked');
    expect(on('os-too-old').ready).toBe(false);
  });

  it('is ready when nothing is left', () => {
    expect(on().ready).toBe(true);
    expect(on().hand).toBe('ios');
  });
});

describe('what the drivers say of phones', () => {
  const provider = (over: object) => ({
    list: async () => [],
    handles: () => true,
    open: () => {
      throw new Error('no phone is opened to look at it');
    },
    ...over,
  });

  it('leaves out what is virtual, and asks each phone what is in its way', async () => {
    const list = async () => [
      { serial: 'emulator-5554', state: 'device', ready: true },
      { serial: 'A-B', state: 'booted', ready: true },
      { serial: 'R5C', state: 'unauthorized', ready: false },
    ];
    const seen = await listedPhones(
      [provider({ list, need: async () => 'not-trusted' })] as never,
      async () => ({ input: '', install: '' }),
    );
    expect(seen).toEqual([
      { serial: 'R5C', state: 'unauthorized', ready: false, need: 'not-trusted' },
    ]);
  });

  it('reads a switch only of a phone that allows it, and a failed read says nothing', async () => {
    const list = async () => [{ serial: 'R5C', state: 'device', ready: true }];
    const failed = await listedPhones([provider({ list })] as never, async () => {
      throw new Error('gone');
    });
    expect(failed[0]).toEqual({ serial: 'R5C', state: 'device', ready: true });
  });

  it('takes a driver that fails to list for one with nothing to say', async () => {
    const list = async () => {
      throw new Error('no such tool');
    };
    expect(await listedPhones([provider({ list })] as never, async () => undefined)).toEqual([]);
  });

  it('names what a runner asks of this Mac', () => {
    const checks = [
      { name: 'node', ok: true, detail: '' },
      { name: 'xcode', ok: true, detail: '' },
      { name: 'ios runner (iPhone)', ok: false, detail: '' },
      { name: 'iPhone signing', ok: false, detail: '' },
      { name: 'ios runner (simulator)', ok: true, detail: '' },
    ];
    expect(runnerChecks(checks).map((c) => c.name)).toEqual([
      'xcode',
      'ios runner (iPhone)',
      'iPhone signing',
    ]);
  });
});
