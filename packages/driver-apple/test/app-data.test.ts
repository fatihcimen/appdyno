import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Devicectl } from '../src/devicectl.js';
import { PhoneApps } from '../src/phone-manage.js';
import type { Simctl } from '../src/simctl.js';
import { SimulatorApps } from '../src/simulator-manage.js';

const UDID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const APP = 'dev.appdyno.fixture';

describe('an iOS app data', () => {
  let folder: string;
  let container: string;
  const put = (at: string, name: string, text: string) => {
    mkdirSync(join(at), { recursive: true });
    writeFileSync(join(at, name), text);
  };
  const simulator = () => {
    const simctl = {
      terminate: async () => undefined,
      exec: async (args: string[]) => (args[0] === 'get_app_container' ? `${container}\n` : ''),
    } as unknown as Simctl;
    return new SimulatorApps(simctl, UDID);
  };

  beforeEach(() => {
    folder = mkdtempSync(join(tmpdir(), 'app-data-test-'));
    container = join(folder, 'Devices', UDID, 'data');
    put(join(container, 'Documents'), 'old.txt', 'old');
    put(join(container, 'Library', 'Preferences'), 'p.plist', 'prefs');
    put(container, '.com.apple.mobile_container_manager.metadata.plist', 'system');
  });
  afterEach(() => rmSync(folder, { recursive: true, force: true }));

  it('a simulator gives what the app owns, without the system file beside it', async () => {
    const to = join(folder, 'to');
    mkdirSync(to);
    await simulator().downloadData(APP, to);
    expect(readFileSync(join(to, 'Documents', 'old.txt'), 'utf8')).toBe('old');
    expect(readFileSync(join(to, 'Library', 'Preferences', 'p.plist'), 'utf8')).toBe('prefs');
    expect(existsSync(join(to, '.com.apple.mobile_container_manager.metadata.plist'))).toBe(false);
  });

  it('a simulator replaces what the app owns, and what was there goes', async () => {
    const from = join(folder, 'from');
    put(join(from, 'Documents'), 'new.txt', 'new');
    await simulator().replaceData(APP, from);
    expect(readFileSync(join(container, 'Documents', 'new.txt'), 'utf8')).toBe('new');
    expect(existsSync(join(container, 'Documents', 'old.txt'))).toBe(false);
    expect(existsSync(join(container, 'Library', 'Preferences', 'p.plist'))).toBe(false);
  });

  it('a simulator refuses a container that is not its own', async () => {
    container = join(folder, 'elsewhere');
    await expect(simulator().downloadData(APP, folder)).rejects.toMatchObject({ code: 'INTERNAL' });
  });

  it('a phone stops the app, and what it was not given goes too', async () => {
    const calls: string[][] = [];
    const stops: string[] = [];
    const ctl = {
      udid: UDID,
      terminate: async (app: string) => void stops.push(app),
      json: async (args: string[]) => {
        calls.push(args);
        return {};
      },
    } as unknown as Devicectl;
    const from = join(folder, 'from');
    put(join(from, 'Documents'), 'new.txt', 'new');
    await new PhoneApps(ctl).replaceData(APP, from);
    expect(stops).toEqual([APP]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual(
      expect.arrayContaining(['to', 'appDataContainer', APP, from, '.', 'true']),
    );
  });
});
