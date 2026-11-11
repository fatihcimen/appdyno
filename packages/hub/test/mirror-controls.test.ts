import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type Device, type InputEvent } from '@appdyno/core';
import { afterAll, describe, expect, it, vi, type Mock } from 'vitest';
import { stamp, windowControls, windowLook, type WindowSession } from '../src/controls.js';
import { MEASURE_YOURS, WAKE_AND_OPEN } from '../src/measures.js';
import { DEFAULT_POLICY, PROBE_HINT, type JourneyAnswer, type Policy } from '@appdyno/ops';
import { fakeTimed } from '@appdyno/testing/fake-time.js';

const home = mkdtempSync(join(tmpdir(), 'appdyno-controls-'));
vi.mock('node:os', async (real) => ({
  ...(await real<typeof import('node:os')>()),
  homedir: () => home,
}));
afterAll(() => rmSync(home, { recursive: true, force: true }));

/** Only for what must not happen, which no wait can see: all else waits for what it is after. */
const nothingFor = () => new Promise((r) => setTimeout(r, 400));
/** A gesture takes real time, and more of it on a loaded Mac: a test waits for its end, not for a guess at it. */
const WAIT = { timeout: 10_000 };

/** The fake device's members, as the mocks they are. */
const mocks = (d: Device) =>
  d as unknown as Record<'open' | 'setOrientation' | 'launch' | 'terminate', Mock>;

function fixture(
  platform: 'ios' | 'android',
  device: Partial<Device> = {},
  streams = false,
  policy: Policy = DEFAULT_POLICY,
) {
  const sent: InputEvent[] = [];
  const told: Record<string, unknown>[] = [];
  const recording = {
    start: vi.fn(),
    stop: vi.fn(() => Promise.resolve({ frames: 12 })),
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
    open: vi.fn(() => Promise.resolve(undefined)),
    foreground: vi.fn(() => Promise.resolve('dev.app')),
    setOrientation: vi.fn(() => {
      [picture.w, picture.h] = [picture.h, picture.w];
      return Promise.resolve();
    }),
    screenshot: vi.fn(() => Promise.resolve({ meta: {}, data: Buffer.from('png') })),
    launch: vi.fn(() => Promise.resolve('')),
    terminate: vi.fn(() => Promise.resolve(undefined)),
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
    launch: vi.fn((_app: string, say: (line: string) => void) => {
      say('launch 1 of 5');
      return Promise.resolve(measured);
    }),
    scroll: vi.fn(() => Promise.resolve(measured)),
    journey: vi.fn((_file: string, _app: string | undefined) =>
      Promise.resolve({
        said: measured,
        ran: { totalMs: 412 } as JourneyAnswer,
      }),
    ),
    dashboard: vi.fn(() => Promise.resolve(undefined)),
    history: vi.fn(() => Promise.resolve([])),
  };
  const controls = windowControls(whole, hardware, () => session, measures, policy);
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
    expect(touches[0]?.y).toBeLessThan(0.02);
    expect(touches.every((t) => t.x > 0.8)).toBe(true);
    expect(touches.at(-1)?.y).toBeGreaterThan(0.5);
  });

  it('turns once per press, each way, around the four', async () => {
    const { controls, device } = fixture('android');
    const turns = mocks(device).setOrientation.mock.calls;
    controls.press('rotateRight');
    await vi.waitFor(() => expect(turns).toEqual([[3]]), WAIT);
    controls.press('rotateLeft');
    await vi.waitFor(() => expect(turns).toEqual([[3], [0]]), WAIT);
  });

  it(
    'says so when the app in front does not turn, and asks for no turn it would keep',
    fakeTimed(async () => {
      const { controls, told, device } = fixture('android', {
        setOrientation: vi.fn(() => Promise.resolve(undefined)),
      });
      controls.press('rotateRight');
      await vi.waitFor(
        () => expect(told).toContainEqual({ op: 'note', text: 'The app in front does not turn' }),
        WAIT,
      );
      expect(mocks(device).setOrientation.mock.calls).toEqual([[3], [0]]);
      controls.press('rotateLeft');
      await vi.waitFor(() => expect(mocks(device).setOrientation.mock.calls[2]).toEqual([1]), WAIT);
    }),
  );

  it('says what went wrong beneath the device, and goes on', async () => {
    const { controls, told } = fixture('ios', {
      setOrientation: () => Promise.reject(new Error('no agent here')),
    });
    controls.press('rotateLeft');
    await vi.waitFor(
      () => expect(told).toContainEqual({ op: 'note', text: 'no agent here' }),
      WAIT,
    );
  });
});

describe("a window's captures", () => {
  it('names a file by the clock a person reads, in whatever zone that is', () => {
    vi.useFakeTimers({ now: new Date(2026, 10, 5, 23, 49, 59), toFake: ['Date'] });
    expect(stamp()).toBe('2026-11-05 23.49.59');
    vi.useRealTimers();
  });

  it('saves a screenshot to the Desktop and hands it to the pasteboard', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(join(home, 'Desktop'), { recursive: true });
    const { controls, told } = fixture('ios');
    controls.onWindow({ op: 'control', name: 'screenshot' });
    await vi.waitFor(
      () => expect(told).toContainEqual({ op: 'note', text: 'Saved to the Desktop and copied' }),
      WAIT,
    );
    const copied = told.find((m) => m.op === 'copied') as { file: string };
    expect(copied.file).toContain(join(home, 'Desktop'));
    expect(existsSync(copied.file)).toBe(true);
  });

  it('takes a picture with no agent where the device has its own way', async () => {
    const screenshot = vi.fn(() => Promise.resolve({ data: Buffer.from('png') }));
    const { controls, device, told } = fixture('ios', {
      mirror: { screenshot },
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'copy' });
    await vi.waitFor(() => expect(told.some((m) => m.op === 'copied')).toBe(true), WAIT);
    expect(screenshot).toHaveBeenCalledWith('png');
    expect(mocks(device).open).not.toHaveBeenCalled();
  });

  it("records a stream's own frames, and says so at both ends", async () => {
    const { controls, told, recording } = fixture('android', {}, true);
    controls.onWindow({ op: 'control', name: 'record' });
    await vi.waitFor(() => expect(told).toContainEqual({ op: 'recording', on: true }), WAIT);
    expect(recording.start).toHaveBeenCalledOnce();
    controls.onWindow({ op: 'control', name: 'record' });
    await vi.waitFor(() => {
      expect(told).toContainEqual({ op: 'recording', on: false });
      expect(told).toContainEqual({ op: 'note', text: 'Saved to Movies: 12 frames' });
    }, WAIT);
  });

  it("records by the device's own recorder where the picture is no stream", async () => {
    const start = vi.fn(() => Promise.resolve({ pid: 1 }));
    const stop = vi.fn(() => Promise.resolve({ files: ['a.mp4'] }));
    const { controls, recording } = fixture('ios', {
      recorder: { extension: 'mp4', start, stop },
    });
    controls.onWindow({ op: 'control', name: 'record' });
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), WAIT);
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
    const start = vi.fn((onSample: (s: { at: number }) => void) => {
      onSample({ at: 1 });
      return Promise.resolve(stop);
    });
    const { controls, told } = fixture('ios', {
      liveMetrics: { start },
    });
    expect(start).not.toHaveBeenCalled();
    controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(
      () => expect(told).toContainEqual({ op: 'perf', sample: { at: 1 }, noise: ['mirrored'] }),
      WAIT,
    );
    controls.onWindow({ op: 'perfWatch', on: false });
    await vi.waitFor(() => expect(stop).toHaveBeenCalledOnce(), WAIT);
  });

  it('start an agent only for a device that cannot say what is in front without one', async () => {
    const start = vi.fn(() => Promise.resolve(vi.fn()));
    const live = { liveMetrics: { start } };
    const answers = fixture('ios', {
      ...live,
      foreground: () => Promise.resolve(undefined),
    });
    answers.controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalled(), WAIT);
    expect(mocks(answers.device).open).not.toHaveBeenCalled();
    const refuses = fixture('android', {
      ...live,
      foreground: () => Promise.reject(new Error('no agent')),
    });
    refuses.controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(mocks(refuses.device).open).toHaveBeenCalledOnce(), WAIT);
  });

  it('end with the window', async () => {
    const stop = vi.fn();
    const start = vi.fn(() => Promise.resolve(stop));
    const { controls } = fixture('ios', {
      liveMetrics: { start },
    });
    controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalled(), WAIT);
    await controls.end();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('end only once a reading under way has, as the device closes next', async () => {
    let finish: () => void = () => undefined;
    let ended = false;
    const start = vi.fn(() => Promise.resolve(() => new Promise<void>((r) => (finish = r))));
    const { controls } = fixture('ios', { liveMetrics: { start } });
    controls.onWindow({ op: 'perfWatch', on: true });
    await vi.waitFor(() => expect(start).toHaveBeenCalled(), WAIT);
    const ending = controls.end().then(() => (ended = true));
    await nothingFor();
    expect(ended).toBe(false);
    finish();
    await ending;
    expect(ended).toBe(true);
  });
});

describe("a window's Apps pane", () => {
  const apps = {
    listApps: vi.fn(() => Promise.resolve([{ id: 'a.b', name: 'App' }])),
    uninstall: vi.fn(() => Promise.resolve(undefined)),
  };

  it('lists them', async () => {
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'list' });
    await vi.waitFor(
      () => expect(told).toContainEqual({ op: 'apps', apps: [{ id: 'a.b', name: 'App' }] }),
      WAIT,
    );
  });

  it('launches and quits, on a device made ready for it', async () => {
    const { controls, device } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'launch', id: 'a.b' });
    controls.onWindow({ op: 'app', action: 'quit', id: 'a.b' });
    await vi.waitFor(() => {
      expect(mocks(device).launch).toHaveBeenCalledWith('a.b');
      expect(mocks(device).terminate).toHaveBeenCalledWith('a.b');
    }, WAIT);
    expect(mocks(device).open).toHaveBeenCalledOnce();
  });

  it('says what became of a launch or a quit, by the name of the app', async () => {
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'launch', id: 'a.b' });
    await vi.waitFor(
      () =>
        expect(told).toContainEqual(expect.objectContaining({ op: 'apps', note: 'Launched App' })),
      WAIT,
    );
    controls.onWindow({ op: 'app', action: 'quit', id: 'a.b' });
    await vi.waitFor(
      () => expect(told).toContainEqual(expect.objectContaining({ op: 'apps', note: 'Quit App' })),
      WAIT,
    );
  });

  it('removes an app and shows the list without it', async () => {
    apps.uninstall.mockClear();
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    controls.onWindow({ op: 'app', action: 'remove', id: 'a.b' });
    await vi.waitFor(() => expect(told.some((m) => m.op === 'apps')).toBe(true), WAIT);
    expect(apps.uninstall).toHaveBeenCalledWith('a.b');
  });

  it("lists them again after an agent's call puts an app on the device or takes one off, and after no other", async () => {
    const { controls, told } = fixture('ios', { apps } as unknown as Partial<Device>);
    const call = (tool: string, action: string, ok = true) =>
      controls.heard({ at: 0, tool, ms: 1, ok, args: { action } });
    call('app', 'launch');
    call('app', 'install', false);
    call('tap', 'install');
    await new Promise((r) => setTimeout(r, 50));
    expect(told.filter((m) => m.op === 'apps')).toEqual([]);
    for (const action of ['install', 'uninstall', 'build_and_run']) call('app', action);
    await vi.waitFor(() => expect(told.filter((m) => m.op === 'apps')).toHaveLength(3), WAIT);
  });

  it('keeps to --allow-apps, as the Links and Push panes do: another app is not launched, quit or removed', async () => {
    apps.uninstall.mockClear();
    const only = { ...DEFAULT_POLICY, apps: ['dev.app'] };
    const { controls, device, told } = fixture(
      'ios',
      { apps } as unknown as Partial<Device>,
      false,
      only,
    );
    for (const action of ['launch', 'quit', 'remove'] as const)
      controls.onWindow({ op: 'app', action, id: 'a.b' });
    await vi.waitFor(
      () =>
        expect(
          told.filter(
            (m) => m.op === 'note' && String(m.text).includes('a.b is not an allowed app'),
          ),
        ).toHaveLength(3),
      WAIT,
    );
    expect(mocks(device).launch).not.toHaveBeenCalled();
    expect(mocks(device).terminate).not.toHaveBeenCalled();
    expect(apps.uninstall).not.toHaveBeenCalled();
  });
});

describe("a window's measures", () => {
  const yours = { apps: { listApps: () => Promise.resolve([{ id: 'dev.app', name: 'App' }]) } };
  const answer = (told: Record<string, unknown>[]) => told.find((m) => m.op === 'measured');

  it('measure the app in front by the tool an agent calls, and say how it goes', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureLaunch' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.launch.mock.calls[0]?.[0]).toBe('dev.app');
    expect(told).toContainEqual({ op: 'measuring', line: 'launch 1 of 5' });
    expect(answer(told)).toMatchObject({ ok: true, title: 'Cold launch', value: '412 ms' });
  });

  it("leave alone what is the system's: a measure restarts what it measures", async () => {
    const { controls, told, measures } = fixture('ios', {
      ...yours,
      foreground: () => Promise.resolve('com.apple.springboard'),
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.scroll).not.toHaveBeenCalled();
    expect(answer(told)).toMatchObject({
      title: 'Open an app first',
      detail: 'com.apple.springboard is in front',
      hint: MEASURE_YOURS,
    });
    expect(must(answer(told), 'the answer').ok).toBeUndefined();
  });

  it('say what to do where nothing is in front, as when the screen is off: the row is short, the note whole', async () => {
    const { controls, told, measures } = fixture('android', {
      ...yours,
      foreground: () => Promise.resolve(''),
    } as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'measureLaunch' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.launch).not.toHaveBeenCalled();
    expect(answer(told)).toMatchObject({ detail: 'No app is in front', hint: WAKE_AND_OPEN });
  });

  it('say why there is no number, and let the next one run', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.scroll.mockRejectedValueOnce(new Error('S is held by pid 7 (appdyno mcp)'));
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toMatchObject({ title: 'No measure' });
    expect(String(answer(told)?.detail)).toContain('held by pid 7');
    told.length = 0;
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toMatchObject({ ok: true });
  });

  it('say whether the Mac kept a line of it, which stands in for it, or none, and it stays', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    const line = { title: 'Scroll', value: '1% jank', detail: '', why: '2026-11-09T08:00:00Z' };
    measures.history.mockResolvedValueOnce([]).mockResolvedValue([line] as never);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toMatchObject({ ok: true, kept: true }), WAIT);
    told.length = 0;
    // too few frames: nothing new is kept, and the answer is all there is of it
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toMatchObject({ ok: true, kept: false }), WAIT);
  });

  it('name the device in what a measure says as it goes, as a person does', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.scroll.mockImplementationOnce(((_app: string, say: (line: string) => void) => {
      say('connecting to S');
      return Promise.resolve({ title: 'Scroll', value: '1%', detail: '', why: '', flagged: false });
    }) as never);
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(told).toContainEqual({ op: 'measuring', line: 'connecting to Test Phone' });
    expect(told).toContainEqual({ op: 'measuring', line: 'Starting the device agent' });
  });

  it("say what a refusal says to do next in the person's words, and a tool's hint they have none for not at all", async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.scroll.mockRejectedValueOnce(
      Object.assign(new Error('relaunched with the frame probe'), { hint: PROBE_HINT }),
    );
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toEqual({
      op: 'measured',
      title: 'No measure',
      detail: 'relaunched with the frame probe',
      hint: 'Go back to the screen to measure, then measure once more: the frame probe stays in the app until it quits',
    });
    told.length = 0;
    measures.scroll.mockRejectedValueOnce(
      Object.assign(new Error('no text "Send" on the screen'), {
        hint: 'screen lists the elements, each by its ref, role and words',
      }),
    );
    controls.onWindow({ op: 'control', name: 'measureScroll' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(answer(told)).toEqual({
      op: 'measured',
      title: 'No measure',
      detail: 'no text "Send" on the screen',
    });
  });

  it('run a journey as any other, and hand back what it ran', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    expect(await controls.journey('x.flow')).toEqual({ totalMs: 412 });
    expect(measures.journey.mock.calls[0]?.slice(0, 2)).toEqual(['x.flow', 'dev.app']);
    expect(answer(told)).toMatchObject({ ok: true, value: '412 ms' });
  });

  it("give a journey no app of the system's, which a flow would stop", async () => {
    const { controls, measures } = fixture('ios', {
      apps: { listApps: () => Promise.resolve([]) },
    } as unknown as Partial<Device>);
    await controls.journey('x.flow');
    expect(must(measures.journey.mock.calls[0], 'a journey')[1]).toBeUndefined();
  });

  it('say why a journey did not run, and hand back nothing', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    measures.journey.mockRejectedValueOnce(new Error('no text "Send" on the screen'));
    expect(await controls.journey('x.flow')).toBeUndefined();
    expect(answer(told)).toMatchObject({
      title: 'No measure',
      detail: 'no text "Send" on the screen',
    });
    told.length = 0;
    // a flow's failure as a journey's run gives it: its file, the step, and what the screen held, each a line
    measures.journey.mockRejectedValueOnce(
      new Error(
        '/Users/me/flows/sign in.flow:4: step 2 failed: tap id=open_form\nno element matches id="open_form" after 1500 ms; nearest: @v181 button "Back" 38,84',
      ),
    );
    expect(await controls.journey('sign in.flow')).toBeUndefined();
    expect(answer(told)).toMatchObject({ detail: 'step 2 failed: tap id=open_form' });
  });

  it('take a journey from the window with the file a person chose', async () => {
    const { controls, told, measures } = fixture('ios', yours as unknown as Partial<Device>);
    controls.onWindow({ op: 'control', name: 'journey', file: 'chosen.flow' });
    await vi.waitFor(() => expect(answer(told)).toBeDefined(), WAIT);
    expect(measures.journey.mock.calls[0]?.[0]).toBe('chosen.flow');
  });

  it('try the device agent again after it failed to start', async () => {
    const open = vi.fn(() => Promise.resolve(undefined));
    open.mockRejectedValueOnce(new Error('not yet'));
    const { controls } = fixture('ios', {
      open,
      tree: () => Promise.resolve({ nodes: [] }),
    } as unknown as Partial<Device>);
    await expect(controls.read()).rejects.toThrow('not yet');
    await expect(controls.read()).resolves.toEqual({ nodes: [] });
  });

  it('read the screen only once the device agent is up', async () => {
    const order: string[] = [];
    const { controls } = fixture('ios', {
      open: () => {
        order.push('open');
        return Promise.resolve();
      },
      tree: () => {
        order.push('tree');
        return Promise.resolve({ nodes: [] });
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
    const start = vi.fn(() => Promise.resolve(stop));
    const { controls, told, measures } = fixture('ios', {
      ...yours,
      liveMetrics: { start },
    } as unknown as Partial<Device>);
    let stoppedBefore = 0;
    measures.scroll.mockImplementationOnce(() => {
      stoppedBefore = stop.mock.calls.length;
      return Promise.resolve({ title: 'Scroll', value: '1%', detail: '', why: '', flagged: false });
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
    const start = vi.fn(() => Promise.resolve(stop));
    const { controls } = fixture('ios', { liveMetrics: { start } });
    controls.onWindow({ op: 'perfWatch', on: true });
    controls.onWindow({ op: 'perfWatch', on: false });
    await controls.end();
    expect(start.mock.calls.length).toBe(stop.mock.calls.length);
  });

  it('ask a device that can tell of all its apps, and give its own source the app', async () => {
    const start = vi.fn(() => Promise.resolve(vi.fn()));
    const { controls, measures } = fixture('ios', {
      ...yours,
      foreground: () => Promise.resolve('com.apple.springboard'),
      frontApp: () => Promise.resolve('dev.app'),
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
      const start = vi.fn(() => Promise.resolve(stop));
      const frontApp = vi.fn(() => Promise.resolve('dev.app'));
      const { controls } = fixture('ios', {
        ...yours,
        frontApp,
        liveMetrics: { start },
      } as unknown as Partial<Device>);
      controls.onWindow({ op: 'perfWatch', on: true });
      await vi.waitFor(() => expect(start).toHaveBeenCalledOnce(), WAIT);
      vi.advanceTimersByTime(5_000);
      await nothingFor();
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

  it(
    'tell the pane of the app in front as it changes, where the measures ask each turn',
    fakeTimed(async () => {
      vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
      try {
        const foreground = vi.fn(() => Promise.resolve('dev.app'));
        // the numbers are not what this is about: each read says it has none
        const measure = new Proxy(
          { slowReads: [] },
          {
            get: (t, k) =>
              k === 'slowReads' ? t.slowReads : () => Promise.reject(new Error('none')),
          },
        );
        const { controls, told, measures } = fixture('android', {
          measure,
          apps: {
            listApps: () =>
              Promise.resolve([
                { id: 'dev.app', name: 'App' },
                { id: 'dev.other', name: 'Other' },
              ]),
          },
          foreground,
        } as unknown as Partial<Device>);
        const results = () => told.filter((m) => m.op === 'results');
        controls.onWindow({ op: 'perfWatch', on: true });
        await vi.waitFor(
          () => expect(results()).toEqual([{ op: 'results', results: [], app: 'App' }]),
          WAIT,
        );
        foreground.mockResolvedValue('dev.other');
        vi.advanceTimersByTime(5_000);
        await vi.waitFor(() => expect(results().at(-1)).toMatchObject({ app: 'Other' }), WAIT);
        expect(measures.history).toHaveBeenLastCalledWith('dev.other');
        // what is the system's has no name: the pane asks for an app again
        foreground.mockResolvedValue('com.android.launcher');
        vi.advanceTimersByTime(5_000);
        await vi.waitFor(
          () => expect(results().at(-1)).toEqual({ op: 'results', results: [] }),
          WAIT,
        );
        controls.onWindow({ op: 'perfWatch', on: false });
        await controls.end();
        foreground.mockClear();
        vi.advanceTimersByTime(20_000);
        expect(foreground).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    }),
  );

  it('open the page of every kept run', async () => {
    const { controls, measures } = fixture('ios');
    controls.onWindow({ op: 'control', name: 'dashboard' });
    await vi.waitFor(() => expect(measures.dashboard).toHaveBeenCalledOnce(), WAIT);
  });
});
