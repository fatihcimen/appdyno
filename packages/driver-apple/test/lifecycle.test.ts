import { spawn } from 'node:child_process';
import { must, type Backgrounds } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { describe, expect, it } from 'vitest';
import { Devicectl } from '../src/devicectl.js';
import { PHONE_CANNOT, PhoneLifecycle } from '../src/phone-lifecycle.js';
import { EVERY_APP, PHOTOS_KEEP, SimulatorLifecycle } from '../src/sim-lifecycle.js';
import { Simctl } from '../src/simctl.js';

const SIM = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
const PHONE = '00008110-0011223344556677';
const APP = 'dev.appdyno.fixture';
const WARNINGS = `/Users/me/Library/Developer/CoreSimulator/Devices/${SIM}/data/var/run/memory_warning_simulation`;

/** A device whose app is out of the front, running while `runs` says so. */
const device = (runs: () => boolean): Backgrounds => ({
  foreground: () => Promise.resolve('com.apple.springboard'),
  key: () => Promise.resolve({}),
  appRunning: () => Promise.resolve(runs()),
});

/** A simulator whose tool answers as `answers` says, each command kept. */
function simulator(answers: Partial<Record<string, string | Error>> = {}, pid = 4242) {
  const ran: string[][] = [];
  const simctl = Object.assign(new Simctl({}), {
    exec: (args: string[]) => {
      ran.push(args);
      const a = answers[args[0] === 'spawn' ? must(args[2], 'a command') : must(args[0], 'a verb')];
      return a instanceof Error ? Promise.reject(a) : Promise.resolve(a ?? '');
    },
    pid: () => Promise.resolve(pid),
  });
  return { simctl, ran };
}

const refusal = (p: Promise<unknown>) =>
  p.then(
    () => undefined,
    (e: unknown) => e as DeviceError,
  );

describe("a simulator's memory warning", () => {
  it("changes the times of the file its processes watch, by the runtime's own truncate inside it", async () => {
    const { simctl, ran } = simulator({ getenv: `${WARNINGS}\n` });
    const life = new SimulatorLifecycle(
      simctl,
      SIM,
      device(() => true),
    );
    await expect(life.memoryWarning(APP)).resolves.toBe(EVERY_APP);
    expect(ran).toEqual([
      ['getenv', SIM, 'SIMULATOR_MEMORY_WARNINGS'],
      ['spawn', SIM, 'truncate', '-s', '0', WARNINGS],
    ]);
  });

  it('refuses a level, an app with no process, and a runtime that names no such file or cannot change it', async () => {
    const running = new SimulatorLifecycle(
      simulator().simctl,
      SIM,
      device(() => true),
    );
    const level = await refusal(running.memoryWarning(APP, 'RUNNING_LOW'));
    expect(level?.code).toBe('INVALID_ARGUMENT');
    expect(level?.message).toBe(
      "an iOS memory warning has no level: RUNNING_LOW is one of Android's trim levels",
    );
    const stopped = new SimulatorLifecycle(
      simulator().simctl,
      SIM,
      device(() => false),
    );
    expect((await refusal(stopped.memoryWarning(APP)))?.code).toBe('APP_NOT_RUNNING');
    expect((await refusal(running.memoryWarning(APP)))?.message).toContain(
      'names no file for its memory warnings',
    );
    const broken = simulator({ getenv: WARNINGS, truncate: new Error('no such file: truncate') });
    const old = new SimulatorLifecycle(
      broken.simctl,
      SIM,
      device(() => true),
    );
    const e = await refusal(old.memoryWarning(APP));
    expect(e?.code).toBe('UNSUPPORTED');
    expect(e?.message).toContain('no such file: truncate');
  });
});

describe("a simulator's shake and photos", () => {
  it('posts the notification UIKit takes for a shake', async () => {
    const { simctl, ran } = simulator();
    const said = await new SimulatorLifecycle(
      simctl,
      SIM,
      device(() => true),
    ).shake();
    expect(ran).toEqual([['spawn', SIM, 'notifyutil', '-p', 'com.apple.UIKit.SimulatorShake']]);
    expect(said).toBe('the app in front gets it');
  });

  it('adds the files to Photos, and says it has no way to take them out', async () => {
    const { simctl, ran } = simulator({ getenv: '/nowhere' });
    const life = new SimulatorLifecycle(
      simctl,
      SIM,
      device(() => true),
    );
    // a library whose rows cannot be read is counted by nobody
    await expect(life.addMedia(['/p/a.png', '/p/b.mov'])).resolves.toBe(PHOTOS_KEEP);
    expect(ran[0]).toEqual(['addmedia', SIM, '/p/a.png', '/p/b.mov']);
  });
});

describe("an app's end in the background", () => {
  it("kills the simulator app's own process on this Mac", async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    let alive = true;
    child.on('exit', () => (alive = false));
    const { simctl } = simulator({}, must(child.pid, "the child's pid"));
    const life = new SimulatorLifecycle(
      simctl,
      SIM,
      device(() => alive),
    );
    await expect(life.endInBackground(APP)).resolves.toBeUndefined();
    expect(child.signalCode).toBe('SIGKILL');
  });

  it("asks devicectl for an iPhone app's end by SIGKILL, and its memory warning by its pid", async () => {
    const asked: string[][] = [];
    let alive = true;
    const ctl = Object.assign(new Devicectl(PHONE), {
      pid: () => Promise.resolve(77),
      json: (args: string[]) => {
        asked.push(args);
        if (args.includes('--kill')) alive = false;
        return Promise.resolve({});
      },
    });
    const life = new PhoneLifecycle(
      ctl,
      device(() => alive),
    );
    await life.memoryWarning(APP);
    await life.endInBackground(APP);
    expect(asked).toEqual([
      ['device', 'process', 'sendMemoryWarning', '--device', PHONE, '--pid', '77'],
      ['device', 'process', 'terminate', '--device', PHONE, '--pid', '77', '--kill'],
    ]);
  });

  it('refuses an iPhone shake and photos, saying why', async () => {
    const life = new PhoneLifecycle(
      new Devicectl(PHONE),
      device(() => true),
    );
    expect((await refusal(life.shake()))?.message).toBe(PHONE_CANNOT.shake);
    expect((await refusal(life.addMedia()))?.message).toBe(PHONE_CANNOT.media);
    expect((await refusal(life.memoryWarning(APP, 'COMPLETE')))?.code).toBe('INVALID_ARGUMENT');
  });
});
