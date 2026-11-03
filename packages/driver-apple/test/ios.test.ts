import { describe, expect, it } from 'vitest';
import { IosSimulatorDevice } from '../src/simulator.js';
import { IosPhoneDevice } from '../src/phone.js';
import { startPhase } from '../src/runner.js';
import type { Tree } from '@appdyno/protocol';
import { assertBundle, assertUdid } from '../src/simctl.js';

describe('simulator inputs', () => {
  it('takes only a simulator id, never "booted" or a name', () => {
    expect(assertUdid('7994F239-7CD7-4247-9FC0-4F92C7CFC951')).toBeTruthy();
    for (const bad of ['booted', 'QA iPhone', '7994f239-7cd7-4247-9fc0-4f92c7cfc951; rm -rf ~'])
      expect(() => assertUdid(bad), bad).toThrow(/not a simulator id/);
  });

  it('takes only a bundle id', () => {
    expect(assertBundle('dev.appdyno.fixture')).toBe('dev.appdyno.fixture');
    for (const bad of ['fixture', 'a.b c', 'a.b;ls', '-x.y'])
      expect(() => assertBundle(bad), bad).toThrow(/not a bundle id/);
  });
});

describe('iPhone inputs', () => {
  it('takes an iPhone UDID in either form, nothing else', async () => {
    const { assertPhoneUdid } = await import('../src/phone.js');
    expect(assertPhoneUdid('00001234-0123456789ABCDEF')).toBeTruthy();
    expect(assertPhoneUdid('0123456789abcdef0123456789abcdef01234567')).toBeTruthy();
    for (const bad of [
      '7994F239-7CD7-4247-9FC0-4F92C7CFC951',
      'iPhone',
      '00001234-0123456789ABCDEF; ls',
    ])
      expect(() => assertPhoneUdid(bad), bad).toThrow(/not an iPhone UDID/);
  });
});

describe('the link prompt', () => {
  type Box = [number, number, number, number];
  const prompt = (labels: string[]): Tree => ({
    windows: [
      {
        type: 1,
        pkg: 'com.example.app',
        layer: 0,
        b: [0, 0, 402, 874],
        active: true,
        focused: true,
      },
      {
        type: 3,
        pkg: 'com.apple.springboard',
        layer: 1,
        b: [60, 350, 342, 520],
        active: false,
        focused: false,
      },
    ],
    nodes: [
      { p: -1, w: 0, c: 'Application', b: [0, 0, 402, 874], f: 1 },
      { p: -1, w: 1, c: 'Alert', d: '“App” içinde açılsın mı?', b: [60, 350, 342, 520], f: 1 },
      ...labels.map((d, i) => ({
        p: 1,
        w: 1,
        c: 'Button',
        d,
        b: [60 + i * 141, 470, 201 + i * 141, 520] as Box,
        f: 3,
      })),
    ],
    truncated: false,
    elapsedMs: 1,
    hash: 'h',
  });

  it('confirms by place in any language: the second of two buttons', async () => {
    const { promptButton } = await import('../src/device.js');
    expect(promptButton(prompt(['Vazgeç', 'Aç']))).toEqual({ x: 271.5, y: 495 });
    expect(promptButton(prompt(['Abbrechen', 'Öffnen']))).toEqual({ x: 271.5, y: 495 });
  });

  it('falls back to the word with another count of buttons, and finds nothing without a prompt', async () => {
    const { promptButton } = await import('../src/device.js');
    expect(promptButton(prompt(['Cancel', 'Open', 'Always']))).toEqual({ x: 271.5, y: 495 });
    expect(promptButton(prompt(['OK']))).toBeUndefined();
    expect(
      promptButton({ ...prompt([]), windows: prompt([]).windows.slice(0, 1) }),
    ).toBeUndefined();
  });
});

describe('a starting runner', () => {
  it("says where it has got to, by xcodebuild's log", () => {
    expect(startPhase('Command line invocation:\n')).toMatch(/preparing/);
    expect(startPhase('Testing started\n')).toMatch(/launching/);
    expect(startPhase("Test Suite 'Runner' started at 2026\n")).toMatch(/port/);
  });
});

describe('the kind of device', () => {
  it('calls a simulator virtual, and a phone not, nor its measures', () => {
    expect(new IosSimulatorDevice('7994F239-7CD7-4247-9FC0-4F92C7CFC951').virtual).toBe(true);
    const phone = new IosPhoneDevice('00001234-0123456789ABCDEF', { profile: '/p' });
    expect(phone.virtual).toBe(false);
    expect(phone.measure.virtual).toBeUndefined();
  });
});
