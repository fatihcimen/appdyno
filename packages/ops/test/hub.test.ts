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
import { startOf } from '@appdyno/core';
import { hubDevices, runHub, type HubDevice } from '../src/mirror/hub.js';
import { removeMirrorFile, writeMirrorFile } from '../src/mirror/state.js';
import { DEFAULT_POLICY, ServerContext } from '../src/index.js';

class Simulated implements VirtualDevices {
  readonly kind = 'simulator';
  readonly platform = 'ios';
  all: Startable[] = [
    { id: 'A', name: 'iPhone 17', state: 'stopped', model: 'iPhone 17' },
    { id: 'B', name: 'iPad Air', state: 'running', serial: 'B', model: 'iPad Air' },
  ];
  boot = vi.fn(async (id: string) => id);
  shutdown = vi.fn(async () => undefined);
  startable = async () => this.all;
  catalog = vi.fn(async () => ({ models: [{ id: 'm', name: 'M' }], systems: [] }));
  create = vi.fn(async (d: NewDevice) => d.name);
}

const phone = { serial: 'R58M', state: 'device', ready: true, model: 'SM-S918B' };

function context(virtual: VirtualDevices, connected = [phone], mirrorCommand?: string[]) {
  const provider: DeviceProvider = {
    list: async () => connected,
    handles: () => true,
    open: () =>
      ({
        hardware: async () => ({
          platform: 'android',
          controls: [],
          model: 'SM-S918B',
          name: 'Galaxy S23 Ultra',
        }),
      }) as unknown as Device,
    virtual,
  };
  return new ServerContext(DEFAULT_POLICY, [provider], { ...(mirrorCommand && { mirrorCommand }) });
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

  it('does not list a running virtual device twice', async () => {
    const ctx = context(new Simulated(), [
      { serial: 'B', state: 'booted', ready: true, model: '' },
    ]);
    const devices = await hubDevices(ctx, async () => undefined);
    expect(devices.filter((d) => d.serial === 'B')).toHaveLength(1);
  });

  it('leaves out what this server may not drive', async () => {
    const provider = new Simulated();
    const allowed = new ServerContext({ ...DEFAULT_POLICY, devices: /^R58M$/ }, [
      {
        list: async () => [phone],
        handles: () => true,
        open: () => ({ hardware: async () => undefined }) as unknown as Device,
        virtual: provider,
      },
    ]);
    const devices = await hubDevices(allowed, async () => undefined);
    expect(devices.map((d) => d.id)).toEqual(['R58M']);
  });

  it('asks nothing of what this server may not drive, as that refuses', async () => {
    const provider: DeviceProvider = {
      list: async () => [phone],
      handles: () => true,
      open: () => ({ hardware: async () => undefined }) as unknown as Device,
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

  it('brings a window that died back, and stops after three in a minute', async () => {
    const windows = [window(), window(), window(), window()];
    const made = [...windows];
    const ctx = context(new Simulated());
    const done = runHub(ctx, {
      focus: false,
      log: () => undefined,
      viewer: () => made.shift()!.link,
    });
    await vi.waitFor(() => expect(lastList(windows[0]!.told)).toBeDefined());
    windows[0]!.die();
    await vi.waitFor(() => expect(lastList(windows[1]!.told)).toBeDefined());
    windows[1]!.die();
    windows[2]!.die();
    windows[3]!.die();
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
});
