import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chooseDeveloperDir, xcodeEnv, xcodeTool } from '../src/simctl.js';

const dev = (app: string) => `/Applications/${app}/Contents/Developer`;
const CLT = '/Library/Developer/CommandLineTools';

describe('the developer folder', () => {
  it('is the selected one when it is a full Xcode, wherever it lives', () => {
    const selected = '/Users/me/Applications/Xcode-26.0.app/Contents/Developer';
    expect(chooseDeveloperDir(selected, [{ dir: dev('Xcode-27.1.app'), version: '27.1' }])).toBe(
      selected,
    );
  });

  it('is the newest installed when the command line tools are selected', () => {
    const installed = [
      { dir: dev('Xcode.app'), version: '9.4' },
      { dir: dev('Xcode-27.1.0.app'), version: '27.1' },
      { dir: dev('Xcode-16.4.app'), version: '16.4' },
    ];
    expect(chooseDeveloperDir(CLT, installed)).toBe(dev('Xcode-27.1.0.app'));
    expect(chooseDeveloperDir(undefined, installed)).toBe(dev('Xcode-27.1.0.app'));
  });

  it('is none without any Xcode', () => {
    expect(chooseDeveloperDir(CLT, [])).toBeUndefined();
  });

  it('is DEVELOPER_DIR when that is set', () => {
    const env = { DEVELOPER_DIR: '/somewhere' };
    expect(xcodeEnv(env)).toBe(env);
  });
});

describe("a command of Xcode's", () => {
  it('runs by its own path in the developer folder, and by xcrun where the folder has none', () => {
    const dir = mkdtempSync(join(tmpdir(), 'appdyno-developer-'));
    mkdirSync(join(dir, 'usr/bin'), { recursive: true });
    writeFileSync(join(dir, 'usr/bin/simctl'), '');
    expect(xcodeTool('simctl', ['list'], { DEVELOPER_DIR: dir })).toEqual([
      join(dir, 'usr/bin/simctl'),
      ['list'],
    ]);
    expect(xcodeTool('devicectl', ['list'], { DEVELOPER_DIR: dir })).toEqual([
      'xcrun',
      ['devicectl', 'list'],
    ]);
    expect(xcodeTool('simctl', ['list'], {})).toEqual(['xcrun', ['simctl', 'list']]);
  });
});
