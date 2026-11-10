import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  Device,
  DeviceProvider,
  NewDevice,
  Startable,
  ViewerLink,
  ViewerMessage,
  VirtualDevices,
} from '@appdyno/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must, startOf } from '@appdyno/core';
import { runHub, stageLink } from '../src/hub.js';
import { CREATE_REFUSED, hubDevices, type HubDevice } from '../src/hub-list.js';
import { Parent } from '../src/parent.js';
import {
  DEFAULT_POLICY,
  FOCUS_SIGNAL,
  removeMirrorFile,
  ServerContext,
  writeMirrorFile,
} from '@appdyno/ops';

class Simulated implements VirtualDevices {
  readonly kind = 'simulator';
  readonly platform = 'ios';
  all: Startable[] = [
    { id: 'A', name: 'iPhone 17', state: 'stopped', model: 'iPhone 17' },
    { id: 'B', name: 'iPad Air', state: 'running', serial: 'B', model: 'iPad Air' },
  ];
  boot = vi.fn((id: string) => Promise.resolve(id));
  shutdown = vi.fn(() => Promise.resolve(undefined));
  startable = () => Promise.resolve(this.all);
  catalog = vi.fn(() => Promise.resolve({ models: [{ id: 'm', name: 'M' }], systems: [] }));
  create = vi.fn((d: NewDevice) => Promise.resolve(d.name));
}

const phone = { serial: 'R58M', state: 'device', ready: true, model: 'SM-S918B' };

function context(
  virtual: VirtualDevices,
  connected = [phone],
  mirrorCommand?: string[],
  policy = DEFAULT_POLICY,
) {
  const provider: DeviceProvider = {
    list: () => Promise.resolve(connected),
    handles: () => true,
    open: () =>
      ({
        hardware: () =>
          Promise.resolve({
            platform: 'android',
            controls: [],
            model: 'SM-S918B',
            name: 'Galaxy S23 Ultra',
          }),
      }) as unknown as Device,
    virtual,
  };
  return new ServerContext(policy, [provider], { ...(mirrorCommand && { mirrorCommand }) });
}

/** A hub's window, as a test holds it. */
function window() {
  let listener: (m: ViewerMessage) => void = () => undefined;
  let ended: (tail: string) => void = () => undefined;
  const told: Record<string, unknown>[] = [];
  const link: ViewerLink = {
    send: (m) => told.push(m),
    onMessage: (l) => (listener = l),
    onExit: (l) => (ended = l),
    kill: () => ended(''),
  };
  return {
    link,
    told,
    say: (m: ViewerMessage) => listener(m),
    die: () => ended('it crashed'),
    close: () => {
      listener({ op: 'closed' });
      ended('');
    },
  };
}

const lastList = (told: Record<string, unknown>[]) =>
  told.findLast((m) => m.op === 'hub')?.devices as HubDevice[] | undefined;

describe('the hub', () => {
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => rmSync(state, { recursive: true, force: true }));

  it('lists a phone as a person calls it, and each virtual device with its own state', async () => {
    const ctx = context(new Simulated());
    const devices = await hubDevices(ctx, async (s) => ctx.deviceFor(s).hardware());
    expect(devices.map((d) => [d.name, d.kind, d.state])).toEqual([
      ['Galaxy S23 Ultra', 'phone', 'running'],
      ['iPhone 17', 'simulator', 'stopped'],
      ['iPad Air', 'simulator', 'running'],
    ]);
  });

  it('asks each list at once, and keeps one order whichever answers first', async () => {
    const answer = new Map<string, () => void>();
    const held =
      <T>(what: string, value: T) =>
      () =>
        new Promise<T>((done) => answer.set(what, () => done(value)));
    const virtual = (kind: 'simulator' | 'emulator', id: string): VirtualDevices => ({
      kind,
      platform: kind === 'emulator' ? 'android' : 'ios',
      startable: held(kind, [{ id, name: id, state: 'stopped' }]),
      boot: (booted) => Promise.resolve(booted),
      shutdown: () => Promise.resolve(undefined),
    });
    const provider = (kind: 'simulator' | 'emulator', id: string): DeviceProvider => ({
      list: held(`${kind} list`, kind === 'emulator' ? [phone] : []),
      handles: () => true,
      open: () => ({ hardware: () => Promise.resolve(undefined) }) as unknown as Device,
      virtual: virtual(kind, id),
    });
    const ctx = new ServerContext(DEFAULT_POLICY, [
      provider('emulator', 'Pixel'),
      provider('simulator', 'iPhone'),
    ]);
    const rows = hubDevices(ctx, () => Promise.resolve(undefined));
    await vi.waitFor(() => expect(answer.size).toBe(4));
    for (const what of [...answer.keys()].reverse()) {
      must(answer.get(what), what)();
      await new Promise((settled) => setImmediate(settled));
    }
    expect((await rows).map((d) => d.id)).toEqual(['R58M', 'Pixel', 'iPhone']);
  });

  it('does not list a running virtual device twice', async () => {
    const ctx = context(new Simulated(), [
      { serial: 'B', state: 'booted', ready: true, model: '' },
    ]);
    const devices = await hubDevices(ctx, () => Promise.resolve(undefined));
    expect(devices.filter((d) => d.serial === 'B')).toHaveLength(1);
  });

  it('is one row for one phone, by its cable while it has one, and says how it is joined', async () => {
    const onCable = { serial: 'R58M', state: 'device', ready: true, link: 'USB' as const };
    const onWifi = {
      serial: 'adb-R58M-Ab._adb-tls-connect._tcp',
      state: 'device',
      ready: true,
      link: 'Wi-Fi' as const,
      sameAs: 'R58M',
    };
    const rows = (list: (typeof onCable | typeof onWifi)[], policy = DEFAULT_POLICY) =>
      hubDevices(
        new ServerContext(policy, [
          {
            list: () => Promise.resolve(list),
            handles: () => true,
            open: () => ({ hardware: () => Promise.resolve(undefined) }) as unknown as Device,
          },
        ]),
        () => Promise.resolve(undefined),
      ).then((devices) => devices.map((d) => [d.id, d.link, d.detail, d.sameAs]));
    expect(await rows([onCable, onWifi])).toEqual([['R58M', 'USB', '', undefined]]);
    // the sidebar knows it for the phone whose cable row went
    expect(await rows([onWifi])).toEqual([[onWifi.serial, 'Wi-Fi', 'Wi-Fi', 'R58M']]);
    // as a Samsung was, after its Wi-Fi went and came back
    const again = { ...onWifi, serial: 'adb-R58M-Ab (2)._adb-tls-connect._tcp' };
    expect(await rows([again, onWifi])).toEqual([[again.serial, 'Wi-Fi', 'Wi-Fi', 'R58M']]);
    expect(await rows([{ ...again, state: 'offline', ready: false }, onWifi])).toEqual([
      [onWifi.serial, 'Wi-Fi', 'Wi-Fi', 'R58M'],
    ]);
    const onlyItsName = { ...DEFAULT_POLICY, devices: /^adb-R58M-Ab\._adb-tls-connect\._tcp$/ };
    expect(await rows([again, onWifi], onlyItsName)).toEqual([
      [onWifi.serial, 'Wi-Fi', 'Wi-Fi', 'R58M'],
    ]);
  });

  it('leaves out what this server may not drive', async () => {
    const provider = new Simulated();
    const allowed = new ServerContext({ ...DEFAULT_POLICY, devices: /^R58M$/ }, [
      {
        list: () => Promise.resolve([phone]),
        handles: () => true,
        open: () => ({ hardware: () => Promise.resolve(undefined) }) as unknown as Device,
        virtual: provider,
      },
    ]);
    const devices = await hubDevices(allowed, () => Promise.resolve(undefined));
    expect(devices.map((d) => d.id)).toEqual(['R58M']);
  });

  it('asks nothing of what this server may not drive, as that refuses', async () => {
    const provider: DeviceProvider = {
      list: () => Promise.resolve([phone]),
      handles: () => true,
      open: () => ({ hardware: () => Promise.resolve(undefined) }) as unknown as Device,
      virtual: new Simulated(),
    };
    const ctx = new ServerContext({ ...DEFAULT_POLICY, devices: /^B$/ }, [provider]);
    const devices = await hubDevices(ctx, async (s) => ctx.deviceFor(s).hardware());
    expect(devices.map((d) => d.id)).toEqual(['B']);
  });

  it('starts, stops and makes what a person asks, by the driver it belongs to', async () => {
    const virtual = new Simulated();
    const { link, told, say, close } = window();
    const done = runHub(context(virtual), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'start', id: 'A' });
    await vi.waitFor(() => expect(virtual.boot).toHaveBeenCalledWith('A'));
    say({ op: 'hub', action: 'stop', id: 'B' });
    await vi.waitFor(() => expect(virtual.shutdown).toHaveBeenCalledWith('B'));
    say({ op: 'hub', action: 'new', kind: 'simulator', name: 'n', model: 'm', system: 's' });
    await vi.waitFor(() => expect(virtual.create).toHaveBeenCalledOnce());
    close();
    expect(await done).toBe(0);
  });

  it('makes no simulator under an allow list, as a new one could not be on it, and says why', async () => {
    const virtual = new Simulated();
    const { link, told, say, close } = window();
    const done = runHub(
      context(virtual, [phone], undefined, { ...DEFAULT_POLICY, devices: /^emulator-5554$/ }),
      { focus: false, log: () => undefined, viewer: () => link },
    );
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'new', kind: 'simulator', name: 'n', model: 'm', system: 's' });
    await vi.waitFor(() =>
      expect(told).toContainEqual(
        expect.objectContaining({
          op: 'note',
          text: 'create is off while this server has a device allow list',
        }),
      ),
    );
    expect(virtual.create).not.toHaveBeenCalled();
    close();
    expect(await done).toBe(0);
  });

  it('passes what a place asks to what serves it, says its answer, and ends it with itself', async () => {
    const { link, told, say, close } = window();
    const end = vi.fn(() => Promise.resolve(undefined));
    const services = {
      act: vi.fn((m: Record<string, unknown>, tell: (said: Record<string, unknown>) => void) =>
        tell({ heard: m.do }),
      ),
      end,
    };
    const done = runHub(context(new Simulated()), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
      services,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'clients', do: 'list' });
    await vi.waitFor(() => expect(told).toContainEqual({ op: 'clients', heard: 'list' }));
    expect(end).not.toHaveBeenCalled();
    close();
    await done;
    expect(end).toHaveBeenCalledOnce();
  });

  it('outlives another process asking for a window that stands in it', async () => {
    const { link, told, close } = window();
    const before = process.listenerCount(FOCUS_SIGNAL);
    const done = runHub(context(new Simulated()), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    // a process with no handler of this signal is ended by it, and a client's `mirror open` sends it to a hub's pid
    expect(process.listenerCount(FOCUS_SIGNAL)).toBe(before + 1);
    close();
    await done;
    expect(process.listenerCount(FOCUS_SIGNAL)).toBe(before);
  });

  it('closes its streams beside what its services hold, not behind it', async () => {
    const { link, told, close } = window();
    const stopAll = vi.spyOn(Parent.prototype, 'stopAll');
    let held: () => void = () => undefined;
    const end = () => new Promise<void>((done) => (held = done));
    const services = { act: vi.fn(), end };
    const done = runHub(context(new Simulated()), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
      services,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    close();
    await vi.waitFor(() => expect(stopAll).toHaveBeenCalledOnce());
    held();
    await done;
    stopAll.mockRestore();
  });

  it('opens a window of its own as a process of its own', async () => {
    const said = join(state, 'args');
    const command = ['/bin/sh', '-c', `echo "$@" > ${said}.next && mv ${said}.next ${said}`, 'sh'];
    const { link, told, say, close } = window();
    const ctx = context(new Simulated(), [phone], command);
    const done = runHub(ctx, { focus: false, log: () => undefined, viewer: () => link });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'open', serial: 'R58M' });
    await vi.waitFor(() => expect(existsSync(said)).toBe(true));
    expect(readFileSync(said, 'utf8').trim()).toBe('--device R58M');
    close();
    await done;
  });

  it('leaves a device alone while its own window is on its way', async () => {
    const { link, told, say, close } = window();
    const ctx = context(new Simulated(), [phone], ['/usr/bin/true']);
    const open = vi.spyOn(ctx, 'deviceFor');
    const done = runHub(ctx, { focus: false, log: () => undefined, viewer: () => link });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'open', serial: 'R58M' });
    await new Promise((r) => setTimeout(r, 50));
    open.mockClear();
    say({ op: 'hub', action: 'select', serial: 'R58M' });
    await new Promise((r) => setTimeout(r, 50));
    expect(open).not.toHaveBeenCalled();
    close();
    await done;
  });

  it('says at once that a stage has ended once its window has, as a limit would hold the hub up for nothing', () => {
    let gone = false;
    const stage = stageLink(
      () => window().link,
      'R58M',
      new Map(),
      () => gone,
    );
    const early = vi.fn();
    stage.onExit(early);
    expect(early).not.toHaveBeenCalled();
    gone = true;
    const late = vi.fn();
    stage.onExit(late);
    expect(late).toHaveBeenCalledOnce();
  });

  it('takes a device back as soon as its own window has come and gone', async () => {
    const { link, told, say, close } = window();
    const ctx = context(new Simulated(), [phone], ['/usr/bin/true']);
    const done = runHub(ctx, { focus: false, log: () => undefined, viewer: () => link });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'open', serial: 'R58M' });
    writeMirrorFile({
      pid: process.ppid,
      started: startOf(process.ppid),
      session: 's',
      serial: 'R58M',
      status: { state: 'live', since: 1, inputDropped: 0, inputFailed: 0 },
    });
    await vi.waitFor(() => expect(lastList(told)?.[0]?.mirrored).toBe(true), { timeout: 5_000 });
    removeMirrorFile('R58M');
    // a stream of the fake is no matter here: only that it is asked for
    const open = vi.spyOn(ctx, 'deviceFor').mockRejectedValue(new Error('no stream here'));
    say({ op: 'hub', action: 'select', serial: 'R58M' });
    await vi.waitFor(() => expect(open).toHaveBeenCalled());
    close();
    await done;
  });

  it('comes back for a device chosen while its window was on its way, when that is over', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'], shouldAdvanceTime: true });
    const { link, told, say, close } = window();
    const ctx = context(new Simulated(), [phone], ['/usr/bin/true']);
    const open = vi.spyOn(ctx, 'deviceFor');
    const done = runHub(ctx, { focus: false, log: () => undefined, viewer: () => link });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'open', serial: 'R58M' });
    await vi.advanceTimersByTimeAsync(50);
    open.mockClear();
    // being asked is the point here: this phone has no stream to open
    open.mockImplementation(() => {
      throw new Error('no stream here');
    });
    say({ op: 'hub', action: 'select', serial: 'R58M' });
    await vi.advanceTimersByTimeAsync(50);
    expect(open).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(21_000);
    expect(open).toHaveBeenCalledWith('R58M');
    vi.useRealTimers();
    close();
    await done;
  });

  it('brings a window that died back, and stops after three in a minute', async () => {
    const windows = [window(), window(), window(), window()];
    const made = [...windows];
    const ctx = context(new Simulated());
    const done = runHub(ctx, {
      focus: false,
      log: () => undefined,
      viewer: () => must(made.shift(), 'a window').link,
    });
    const w = (i: number) => must(windows[i], `window ${i}`);
    await vi.waitFor(() => expect(lastList(w(0).told)).toBeDefined());
    w(0).die();
    await vi.waitFor(() => expect(lastList(w(1).told)).toBeDefined());
    w(1).die();
    w(2).die();
    w(3).die();
    expect(await done).toBe(0);
  });

  it('says why a thing asked could not be done, and goes on', async () => {
    const virtual = new Simulated();
    virtual.boot.mockRejectedValueOnce(new Error('no runtime'));
    const { link, told, say, close } = window();
    const done = runHub(context(virtual), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    say({ op: 'hub', action: 'start', id: 'A' });
    await vi.waitFor(() => expect(told).toContainEqual({ op: 'note', text: 'no runtime' }));
    close();
    await done;
  });

  it('offers what can be made, kind by kind', async () => {
    const { link, told, close } = window();
    const done = runHub(context(new Simulated()), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    expect(told.find((m) => m.op === 'hub')?.choices).toMatchObject({
      simulator: { models: [{ id: 'm' }] },
    });
    close();
    await done;
  });

  it('says in the sheet why it makes none under a device allow list, before Create is pressed', async () => {
    const { link, told, close } = window();
    const policy = { ...DEFAULT_POLICY, devices: /^B$/ };
    const done = runHub(context(new Simulated(), [phone], undefined, policy), {
      focus: false,
      log: () => undefined,
      viewer: () => link,
    });
    await vi.waitFor(() => expect(lastList(told)).toBeDefined());
    expect(told.find((m) => m.op === 'hub')?.choices).toMatchObject({
      simulator: { models: [{ id: 'm' }], refused: CREATE_REFUSED },
    });
    close();
    await done;
  });
});
