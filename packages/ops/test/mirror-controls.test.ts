import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Device, InputEvent } from '@appdyno/core';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { JourneyAnswer } from '../src/flow/journey.js';
import { windowControls, windowLook, type WindowSession } from '../src/mirror/controls.js';

const home = mkdtempSync(join(tmpdir(), 'appdyno-controls-'));
vi.mock('node:os', async (real) => ({
  ...(await real<typeof import('node:os')>()),
  homedir: () => home,
}));
afterAll(() => rmSync(home, { recursive: true, force: true }));

const settle = () => new Promise((r) => setTimeout(r, 400));
/** A gesture takes real time, and more of it on a loaded Mac: a test waits for its end, not for a guess at it. */
const WAIT = { timeout: 10_000 };

function fixture(platform: 'ios' | 'android', device: Partial<Device> = {}, streams = false) {
  const sent: InputEvent[] = [];
  const told: Record<string, unknown>[] = [];
  const recording = {
    start: vi.fn(),
    stop: vi.fn(async () => ({ frames: 12 })),
  };
  const picture = { w: 1080, h: 2400 };
  const session = {
    send: (e: InputEvent) => sent.push(e),
    tell: (m: Record<string, unknown>) => told.push(m),
    status: { state: 'live', picture },
    recording,
    streamsItsOwn: streams,
    askAgain: vi.fn(),
  } as unknown as WindowSession;
  const whole = {
    serial: 'S',
    mirror: {},
    open: vi.fn(async () => undefined),
    foreground: vi.fn(async () => 'dev.app'),
    setOrientation: vi.fn(async () => {
      [picture.w, picture.h] = [picture.h, picture.w];
    }),
    screenshot: vi.fn(async () => ({ meta: {}, data: Buffer.from('png') })),
    launch: vi.fn(async () => ''),
    terminate: vi.fn(async () => undefined),
    ...device,
  } as unknown as Device;
  const hardware = { platform, controls: [], model: 'Test Phone' };
  const measured = {
    title: 'Cold launch',
    value: '412 ms',
    detail: 'median of 5',
    why: 'dev.app',
    flagged: false,
  };
  const measures = {
    launch: vi.fn(async (_app: string, say: (line: string) => void) => {
      say('launch 1 of 5');
      return measured;
    }),
    scroll: vi.fn(async () => measured),
    journey: vi.fn(async (_file: string, _app: string | undefined) => ({
      said: measured,
      ran: { totalMs: 412 } as JourneyAnswer,
    })),
    dashboard: vi.fn(async () => undefined),
  };
  const controls = windowControls(whole, hardware, () => session, measures);
  return { controls, sent, told, device: whole, session, recording, measures };
}

describe("a window's look", () => {
  it('draws the frame and the controls the device says it has', () => {
    const look = windowLook({ platform: 'android', controls: ['home'], model: 'Test Phone' });
    expect(look).toMatchObject({ controls: ['home'], name: 'Test Phone' });
    expect(look.frame.model).toBe('Test Phone');
    expect(windowLook(undefined).controls).toEqual([]);
  });

  it('names a device as a person does, and frames it by its model', () => {
    const look = windowLook({
      platform: 'android',
      controls: [],
      model: 'SM-S918B',
      name: 'Galaxy S23 Ultra',
    });
    expect(look).toMatchObject({ name: 'Galaxy S23 Ultra', frame: { model: 'SM-S918B' } });
  });
});

describe("a window's controls", () => {
  it("leaves a device's own key to the device", () => {
    const { controls, sent } = fixture('ios');
    expect(controls.press('home')).toBe(false);
    expect(controls.press('lock')).toBe(false);
    expect(sent).toEqual([]);
  });

  it('draws Control Center from the top edge, finger down to finger up', async () => {
    const { controls, sent } = fixture('ios');
    controls.press('controlCenter');
    const touches = sent as { p: number; x: number; y: number }[];
    await vi.waitFor(() => expect(touches.at(-1)?.p).toBe(2), WAIT);
    expect(touches[0]).toMatchObject({ p: 0 });
    expect(touches[0]!.y).toBeLessThan(0.02);
    expect(touches.every((t) => t.x > 0.8)).toBe(true);
    expect(touches.at(-1)!.y).toBeGreaterThan(0.5);
  });

  it('turns once per press, each way, around the four', async () => {
    const { controls, device } = fixture('android');
    controls.press('rotateRight');
    await settle();
    controls.press('rotateLeft');
    await settle();
    expect(vi.mocked(device.setOrientation).mock.calls).toEqual([[3], [0]]);
  });

  it('says so when the app in front does not turn, and asks for no turn it would keep', async () => {
    const { controls, told, device } = fixture('android', {
      setOrientation: vi.fn(async () => undefined),
    });
    controls.press('rotateRight');
    await vi.waitFor(
      () => expect(told).toContainEqual({ op: 'note', text: 'The app in front does not turn' }),
      WAIT,
    );
    expect(vi.mocked(device.setOrientation).mock.calls).toEqual([[3], [0]]);
    controls.press('rotateLeft');
    await vi.waitFor(
      () => expect(vi.mocked(device.setOrientation).mock.calls[2]).toEqual([1]),
      WAIT,
    );
  });

  it('says what went wrong beneath the device, and goes on', async () => {
    const { controls, told } = fixture('ios', {
      setOrientation: async () => {
        throw new Error('no agent here');
      },
    });
    controls.press('rotateLeft');
    await settle();
    expect(told).toContainEqual({ op: 'note', text: 'no agent here' });
  });
});

describe("a window's captures", () => {
  it('saves a screenshot to the Desktop and hands it to the pasteboard', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    const { controls, told } = fixture('ios');
    controls.onWindow({ op: 'control', name: 'screenshot' });
    await settle();
    const copied = told.find((m) => m.op === 'copied') as { file: string };
    expect(copied.file).toContain(join(home, 'Desktop'));
    expect(existsSync(copied.file)).toBe(true);
    expect(told).toContainEqual({ op: 'note', text: 'Saved to the Desktop and copied' });
  });

  it('takes a picture with no agent where the device has its own way', async () => {
    const screenshot = vi.fn(async () => ({ data: Buffer.from('png') }));
    const { controls, device, told } = fixture('ios', {
      mirror: { screenshot },
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'copy' });
    await settle();
    expect(screenshot).toHaveBeenCalledWith('png');
    expect(device.open).not.toHaveBeenCalled();
    expect(told.some((m) => m.op === 'copied')).toBe(true);
  });

  it("records a stream's own frames, and says so at both ends", async () => {
    const { controls, told, recording } = fixture('android', {}, true);
    controls.onWindow({ op: 'control', name: 'record' });
    await settle();
    expect(recording.start).toHaveBeenCalledOnce();
    expect(told).toContainEqual({ op: 'recording', on: true });
    controls.onWindow({ op: 'control', name: 'record' });
    await settle();
    expect(told).toContainEqual({ op: 'recording', on: false });
    expect(told).toContainEqual({ op: 'note', text: 'Saved to Movies: 12 frames' });
  });

  it("records by the device's own recorder where the picture is no stream", async () => {
    const start = vi.fn(async () => ({ pid: 1 }));
    const stop = vi.fn(async () => ({ files: ['a.mp4'] }));
    const { controls, recording } = fixture('ios', {
      recorder: { extension: 'mp4', start, stop },
    });
    controls.onWindow({ op: 'control', name: 'record' });
    await settle();
    expect(start).toHaveBeenCalledOnce();
    expect(recording.start).not.toHaveBeenCalled();
    await controls.end();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('asks for a new stream at a word from the window', () => {
    const { controls, session } = fixture('ios');
    controls.onWindow({ op: 'control', name: 'reconnect' });
    expect(session.askAgain).toHaveBeenCalledOnce();
  });
});

describe("a window's live numbers", () => {
  it('read nothing until they are shown, and stop when they are not', async () => {
    const stop = vi.fn();
    const start = vi.fn(async (onSample: (s: { at: number }) => void) => {
      onSample({ at: 1 });
      return stop;
    });
    const { controls, told } = fixture('ios', {
      liveMetrics: { start },
    } as unknown as Partial<Device>);
    expect(start).not.toHaveBeenCalled();
    controls.onWindow({ op: 'perfWatch', on: true });
    await settle();
    expect(told).toContainEqual({ op: 'perf', sample: { at: 1 }, noise: ['mirrored'] });
    controls.onWindow({ op: 'perfWatch', on: false });
    await settle();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('start an agent only for a device that cannot say what is in front without one', async () => {
    const live = { liveMetrics: { start: async () => vi.fn() } };
    const answers = fixture('ios', {
      ...live,
      foreground: async () => undefined,
    } as unknown as Partial<Device>);
    answers.controls.onWindow({ op: 'perfWatch', on: true });
    await settle();
    expect(answers.device.open).not.toHaveBeenCalled();
    const refuses = fixture('android', {
      ...live,
      foreground: async () => {
        throw new Error('no agent');
      },
    } as unknown as Partial<Device>);
    refuses.controls.onWindow({ op: 'perfWatch', on: true });
    await settle();
    expect(refuses.device.open).toHaveBeenCalledOnce();
  });

  it('end with the window', async () => {
    const stop = vi.fn();
    const { controls } = fixture('ios', {
      liveMetrics: { start: async () => stop },
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'perfWatch', on: true });
    await settle();
    await controls.end();
    expect(stop).toHaveBeenCalledOnce();
  });
});

describe("a window's Apps pane", () => {
  const apps = {
    listApps: vi.fn(async () => [{ id: 'a.b', name: 'App' }]),
    uninstall: vi.fn(async () => undefined),
  };

  it('lists them', async () => {
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'list' });
    await settle();
    expect(told).toContainEqual({ op: 'apps', apps: [{ id: 'a.b', name: 'App' }] });
  });

  it('launches and quits, on a device made ready for it', async () => {
    const { controls, device } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'launch', id: 'a.b' });
    controls.onWindow({ op: 'app', action: 'quit', id: 'a.b' });
    await settle();
    expect(device.launch).toHaveBeenCalledWith('a.b');
    expect(device.terminate).toHaveBeenCalledWith('a.b');
    expect(device.open).toHaveBeenCalledOnce();
  });

  it('removes an app and shows the list without it', async () => {
    apps.uninstall.mockClear();
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'remove', id: 'a.b' });
    await settle();
    expect(apps.uninstall).toHaveBeenCalledWith('a.b');
    expect(told.some((m) => m.op === 'apps')).toBe(true);
  });
});

describe("a window's measures", () => {
  const yours = { apps: { listApps: async () => [{ id: 'dev.app', name: 'App' }] } };
  const answer = (told: Record<string, unknown>[]) => told.find((m) => m.op === 'measured');

  it('measure the app in front by the tool an agent calls, and say how it goes', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureLaunch' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.launch.mock.calls[0]![0]).toBe('dev.app');
    expect(told).toContainEqual({ op: 'measuring', line: 'launch 1 of 5' });
    expect(answer(told)).toMatchObject({ ok: true, title: 'Cold launch', value: '412 ms' });
  });

  it("leave alone what is the system's: a measure restarts what it measures", async () => {
    const { controls, told, measures } = fixture('ios', {
      ...yours,
      foreground: async () => 'com.apple.springboard',
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.scroll).not.toHaveBeenCalled();
    expect(answer(told)).toMatchObject({ title: 'Open an app first' });
    expect(answer(told)!.ok).toBeUndefined();
  });

  it('say why there is no number, and let the next one run', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.scroll.mockRejectedValueOnce(new Error('S is held by pid 7 (appdyno mcp)'));
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toMatchObject({ title: 'No measure' });
    expect(String(answer(told)!.detail)).toContain('held by pid 7');
    told.length = 0;
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toMatchObject({ ok: true });
  });

  it('run a journey as any other, and hand back what it ran', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    expect(await controls.journey('x.flow')).toEqual({ totalMs: 412 });
    expect(measures.journey.mock.calls[0]!.slice(0, 2)).toEqual(['x.flow', 'dev.app']);
    expect(answer(told)).toMatchObject({ ok: true, value: '412 ms' });
  });

  it("give a journey no app of the system's, which a flow would stop", async () => {
    const { controls, measures } = fixture('ios', {
      apps: { listApps: async () => [] },
    } as unknown as Partial<Device>);
    await controls.journey('x.flow');
    expect(measures.journey.mock.calls[0]![1]).toBeUndefined();
  });

  it('say why a journey did not run, and hand back nothing', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.journey.mockRejectedValueOnce(new Error('no text "Send" on the screen'));
    expect(await controls.journey('x.flow')).toBeUndefined();
    expect(answer(told)).toMatchObject({
      title: 'No measure',
      detail: 'no text "Send" on the screen',
    });
  });

  it('take a journey from the window with the file a person chose', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'journey', file: 'chosen.flow' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.journey.mock.calls[0]![0]).toBe('chosen.flow');
  });

  it('try the device agent again after it failed to start', async () => {
    const open = vi.fn(async () => undefined);
    open.mockRejectedValueOnce(new Error('not yet'));
    const { controls } = fixture('ios', {
      open,
      tree: async () => ({ nodes: [] }),
    } as unknown as Partial<Device>);
    await expect(controls.read()).rejects.toThrow('not yet');
    await expect(controls.read()).resolves.toEqual({ nodes: [] });
  });

  it('read the screen only once the device agent is up', async () => {
    const order: string[] = [];
    const { controls } = fixture('ios', {
      open: async () => void order.push('open'),
      tree: async () => {
        order.push('tree');
        return { nodes: [] };
      },
    } as unknown as Partial<Device>);
    await controls.read();
    expect(order).toEqual(['open', 'tree']);
  });

  it('run one at a time', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.scroll).toHaveBeenCalledOnce();
    expect(told).toContainEqual({ op: 'note', text: 'A measure is running' });
  });

  it('stop the readings while they run, whose counts a reading would reset', async () => {
    const stop = vi.fn();
    const start = vi.fn(async () => stop);
    const { controls, told, measures } = fixture('ios', {
      ...yours,
      liveMetrics: { start },
    } as unknown as Partial<Device>);
    let stoppedBefore = 0;
    measures.scroll.mockImplementationOnce(async () => {
      stoppedBefore = stop.mock.calls.length;
      return { title: 'Scroll', value: '1%', detail: '', why: '', flagged: false };
    });
    controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), WAIT);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(stoppedBefore).toBe(1);
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2), WAIT);
  });

  it('leave no reading running that started as its window closed', async () => {
    const stop = vi.fn();
    const start = vi.fn(async () => stop);
    const { controls } = fixture('ios', { liveMetrics: { start } } as unknown as Partial<Device>);
    controls.onWindow({ op: 'perfWatch', on: true });
    controls.onWindow({ op: 'perfWatch', on: false });
    await controls.end();
    expect(start.mock.calls.length).toBe(stop.mock.calls.length);
  });

  it('ask a device that can tell of all its apps, and give its own source the app', async () => {
    const start = vi.fn(async () => vi.fn());
    const { controls, measures } = fixture('ios', {
      ...yours,
      foreground: async () => 'com.apple.springboard',
      frontApp: async () => 'dev.app',
      liveMetrics: { start },
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), WAIT);
    expect((start.mock.calls[0] as unknown[])[1]).toBe('dev.app');
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(measures.scroll).toHaveBeenCalledOnce(), WAIT);
    expect((measures.scroll.mock.calls[0] as unknown[])[0]).toBe('dev.app');
  });

  it('follow a person to another app, and stop looking with the numbers', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    try {
      const stop = vi.fn();
      const start = vi.fn(async () => stop);
      const frontApp = vi.fn(async () => 'dev.app');
      const { controls } = fixture('ios', {
        ...yours,
        frontApp,
        liveMetrics: { start },
      } as unknown as Partial<Device>);
      controls.onWindow({ op: 'perfWatch', on: true });
      await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), WAIT);
      vi.advanceTimersByTime(5_000);
      await settle();
      expect(start).toHaveBeenCalledOnce();
      frontApp.mockResolvedValue('dev.other');
      vi.advanceTimersByTime(5_000);
      await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2), WAIT);
      expect((start.mock.calls[1] as unknown[])[1]).toBe('dev.other');
      expect(stop).toHaveBeenCalledOnce();
      controls.onWindow({ op: 'perfWatch', on: false });
      await vi.waitFor(() => expect(stop).toHaveBeenCalledTimes(2), WAIT);
      frontApp.mockClear();
      vi.advanceTimersByTime(20_000);
      expect(frontApp).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('open the page of every kept run', async () => {
    const { controls, measures } = fixture('ios');
    controls.onWindow({ op: 'control', name: 'dashboard' });
    await vi.waitFor(() => expect(measures.dashboard).toHaveBeenCalledOnce(), WAIT);
  });
});
