import { describe, expect, it } from 'vitest';
import type { AppManager } from '@appdyno/core';
import { Devicectl } from '../src/devicectl.js';
import { appLanguage, launchLanguage } from '../src/manage.js';
import { PhoneApps, PhoneSettings } from '../src/phone-manage.js';
import type { Simctl } from '../src/simctl.js';
import { SimulatorApps, SimulatorSettings } from '../src/simulator-manage.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const PHONE = '00008110-000000000000001E';
const APP = 'dev.appdyno.fixture';

/** A simulator where `running` apps run, and what it was asked. */
const simulator = (running: string[] = []) => {
  const asked: string[][] = [];
  const simctl = {
    exec: (args: string[]) => Promise.resolve((asked.push(args), '')),
    pid: (_: string, app: string) => Promise.resolve(running.includes(app) ? 42 : 0),
    terminate: (_: string, app: string) => {
      asked.push(['terminate', app]);
      return Promise.resolve();
    },
    launch: (_: string, app: string) => {
      asked.push(['launch', app]);
      return Promise.resolve();
    },
  } as unknown as Simctl;
  return {
    settings: new SimulatorSettings(simctl, SIM),
    apps: new SimulatorApps(simctl, SIM),
    asked,
  };
};

describe("an app's language", () => {
  it("of one launch is that launch's alone on a simulator and an iPhone: launch_app holds none", async () => {
    // where a launch's language stays, launch_app holds it as `locale` does: on iOS the next plain launch was in it
    const stays = (apps: AppManager) => apps.languageStays;
    expect(stays(new PhoneApps(new Devicectl(PHONE)))).toBeUndefined();
    const { apps, asked } = simulator();
    expect(stays(apps)).toBeUndefined();
    await apps.launchWith(APP, { language: 'tr' });
    await apps.launchWith(APP, {});
    expect(asked.map((a) => a.slice(3).join(' '))).toEqual([
      `${APP} -AppleLanguages (tr) -AppleLocale tr`,
      APP,
    ]);
  });

  it('is held for its launches on a simulator, which says so, and the whole simulator is left alone', async () => {
    const { settings, asked } = simulator([APP]);
    expect(await settings.get('locale', APP)).toBe('');
    expect(await settings.set('locale', 'tr-TR', APP)).toBe(
      `${APP}'s launches by this tool, not the system's own text: app "" for the whole simulator`,
    );
    expect(await settings.get('locale', APP)).toBe('tr-TR');
    expect(launchLanguage(SIM, APP)).toEqual([
      '-AppleLanguages',
      '(tr-TR)',
      '-AppleLocale',
      'tr_TR',
    ]);
    expect(launchLanguage(SIM, APP, 'de')).toEqual([
      '-AppleLanguages',
      '(de)',
      '-AppleLocale',
      'de',
    ]);
    expect(launchLanguage(SIM, 'other.app')).toEqual([]);
    // it ran, so it started again in it
    expect(asked).toEqual([
      ['terminate', APP],
      ['launch', APP],
    ]);
    await settings.set('locale', '', APP);
    expect(appLanguage(SIM, APP)).toBe('');
  });

  it('says it holds when the app does not start again, and reads as held, so that restore lets it go', async () => {
    const asked: string[][] = [];
    const simctl = {
      exec: (args: string[]) => Promise.resolve((asked.push(args), '')),
      pid: () => Promise.resolve(42),
      terminate: () => {
        return Promise.reject(new Error('the phone went away'));
      },
      launch: () => Promise.resolve(undefined),
    } as unknown as Simctl;
    const settings = new SimulatorSettings(simctl, SIM);
    await expect(settings.set('locale', 'tr-TR', APP)).rejects.toThrow(
      `${APP} is held in tr-TR for this tool's launches, but did not start again: the phone went away`,
    );
    // what is held reads back, so it stays written down to be put back
    expect(await settings.get('locale', APP)).toBe('tr-TR');
    expect(launchLanguage(SIM, APP)).toContain('(tr-TR)');
    await settings.set('locale', '', APP).catch(() => undefined);
    expect(launchLanguage(SIM, APP)).toEqual([]);
  });

  it('with no app is the whole simulator, which says so', async () => {
    const { settings, asked } = simulator();
    expect(await settings.set('locale', 'tr-TR')).toBe(
      "the whole simulator: app for one app's launches",
    );
    expect(asked.map((a) => a.slice(1).join(' '))).toEqual([
      `${SIM} defaults write -g AppleLocale tr_TR`,
      `${SIM} defaults write -g AppleLanguages -array tr-TR`,
    ]);
    expect(launchLanguage(SIM, APP)).toEqual([]);
  });

  it('goes on every launch of an iPhone, and the phone itself is not the tool’s to change', async () => {
    const said: string[][] = [];
    const ctl = new Devicectl(PHONE);
    ctl.json = (args: string[]) =>
      Promise.resolve((said.push(args), { result: { runningProcesses: [] } }));
    ctl.pids = () => Promise.resolve([]);
    const phone = new PhoneSettings(ctl);
    await phone.set('locale', 'pt-BR', APP);
    await ctl.launch(APP);
    expect(said.at(-1)?.slice(-6)).toEqual([
      APP,
      '--',
      '-AppleLanguages',
      '(pt-BR)',
      '-AppleLocale',
      'pt_BR',
    ]);
    await expect(phone.set('locale', 'tr-TR')).rejects.toThrow(
      "an iPhone's language is set on the phone",
    );
    await expect(phone.set('locale', 'tr TR; x', APP)).rejects.toThrow('a language such as tr-TR');
    await phone.set('locale', '', APP);
    await ctl.launch(APP);
    expect(said.at(-1)?.at(-1)).toBe(APP);
  });
});
