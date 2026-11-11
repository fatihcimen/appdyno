import { existsSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must, type AppManager } from '@appdyno/core';
import { parseFlow } from '@appdyno/flows';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { flowRecorder } from '../../src/flow/recorder.js';
import { ACT, defineOp, reply } from '../../src/index.js';
import { FakeDevice, WithKeyboard } from '@appdyno/testing/fake-device.js';
import { callerOf, SECRET, flowHelpers } from './harness.js';

describe('flows', () => {
  let dir: string;
  let device: FakeDevice;
  const { context, refusal, refOf, recorded } = flowHelpers(
    () => device,
    () => dir,
  );
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'appdyno-flow-'));
    vi.stubEnv('APPDYNO_STATE_DIR', join(dir, 'state'));
    device = new FakeDevice();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  describe('recording', () => {
    it('records a tap on what an answer folded into its row, by its own text', async () => {
      const call = callerOf(context());
      device.screen = 'settings';
      const { text } = await recorded(call, async () => {
        const { data } = await call('find', { text: 'Wi-Fi' });
        await call('tap', { ref: must(data.matches[0], 'a match').ref });
      });
      expect(text).toContain('text="Wi-Fi"');
      expect(text).not.toMatch(/@\w/);
    });

    it('writes no step for the links an app opens: they are read, and nothing is opened', async () => {
      device.apps = {
        links: () => Promise.resolve([{ url: 'app://', kind: 'scheme' }]),
      } as unknown as AppManager;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('open_link', { links: 'dev.app' });
        await call('open_link', { url: 'app://x' });
      });
      expect(
        text
          .trim()
          .split('\n')
          .filter((l) => l.startsWith('open_link')),
      ).toEqual(['open_link "app://x"']);
    });

    it('records a tap on a control an answer said once with its row, by its role', async () => {
      const call = callerOf(context());
      device.screen = 'doubled';
      const { text } = await recorded(call, async () => {
        const { data } = await call('find', { role: 'button', text: 'Camera' });
        await call('tap', { ref: must((data.matches as { ref: string }[])[0], 'a match').ref });
      });
      expect(text).toContain('tap role=button text="Camera"');
    });

    it('logs each action with the best selector, whatever named its target', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('launch_app');
        const home = await call('screen');
        await call('tap', { ref: refOf(home.text, 'Form') });
        await call('type_text', { text: 'Ayşe', selector: { id: 'name' } });
        await call('press_key', { key: 'back' });
        await call('open_link', { url: 'app://x' });
        await call('set_location', { lat: 41, lon: 29 });
        await call('swipe', { direction: 'up' });
      });
      expect(text).toBe(`app dev.app

launch !running
tap role=button text="Form"
type "Ayşe" id=name
press_key back
open_link "app://x"
set_location 41 29
swipe up
`);
      expect(text).not.toMatch(/@\w/);
    });

    it('turns a tap at a point into the selector of what is there', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('tap', { x: 500, y: 350 }));
      expect(text).toContain('tap role=button text="Form"\n');
    });

    it('flags coordinates when nothing is there, with the screen they hold for', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('tap', { x: 500, y: 2000 }));
      expect(text).toContain('tap x=500 y=2000 screen=1080x2400 !coordinates\n');
    });

    it('records an ambiguous target with its index, flagged, and says so', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      await call('flow', { action: 'start' });
      const s = await call('screen');
      const second = must(
        [...s.text.matchAll(/(@[a-z0-9-]+) button "Add"/g)][1]?.[1],
        'the second Add',
      );
      await call('tap', { ref: second });
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Add" index=1 !ambiguous');
      expect(stop.text).toContain('look at step 1: ambiguous');
      expect(stop.data.flagged).toEqual(['step 1: ambiguous']);
    });

    it('keeps out of the file what is not an action, or did not happen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('screen');
        await call('find', { text: 'Form' });
        await call('screenshot');
        await call('device_info');
        await refusal(call('tap', { selector: { text: 'Nothing like it' } }));
        await refusal(call('assert', { text: 'Nothing like it' }));
        await refusal(call('wait_for', { text: 'Nothing like it', timeoutMs: 300 }));
        await call('assert', { text: 'Ana sayfa' });
      });
      expect(text).toBe('app dev.app\n\nassert text="Ana sayfa"\n');
    });

    it('logs every step of a `steps` call, each named on its own screen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () =>
        call('steps', {
          steps: [
            { action: 'tap', selector: { text: 'Form' } },
            { action: 'wait_for', id: 'name' },
            { action: 'type_text', text: 'x', selector: { id: 'name' } },
            { action: 'tap', selector: { text: 'Gönder' } },
            { action: 'assert', id: 'result', check: 'text', equals: 'Gönderildi' },
          ],
        }),
      );
      expect(text).toBe(`app dev.app

tap role=button text="Form"
wait_for id=name
type "x" id=name
tap role=button text="Gönder"
assert id=result check=text equals="Gönderildi"
`);
    });

    it('keeps the steps of a `steps` call that ran before one failed', async () => {
      const call = callerOf(context());
      await call('flow', { action: 'start' });
      await refusal(
        call('steps', {
          steps: [
            { action: 'tap', selector: { text: 'Form' } },
            { action: 'tap', selector: { text: 'Nothing like it' } },
          ],
        }),
      );
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Form"');
      expect(stop.text).not.toContain('Nothing like it');
    });

    it('marks an action with no step, so that a replay cannot pass without it', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('gesture', { kind: 'pinch', scale: 2 }));
      expect(text).toContain('unrecorded "gesture pinch"');
    });

    it('leaves a window and a person out: neither is a step of the app, nor stops a replay', async () => {
      const call = callerOf(context());
      await expect(
        recorded(call, async () => {
          await call('mirror', { action: 'status' });
          await call('hand_off', { reason: 'Face ID', timeoutS: 1 });
        }),
      ).rejects.toThrow('nothing was recorded yet');
    });

    it('records an answered alert and a closed keyboard, and neither where nothing was there', async () => {
      device = new WithKeyboard();
      device.permissionUp = true;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('alert', { answer: 'allow' });
        await refusal(call('alert', { answer: 'allow' }));
        await call('keyboard', { action: 'status' });
        await call('keyboard', { action: 'dismiss' });
        await call('keyboard', { action: 'dismiss' });
      });
      expect(text.match(/^alert /gm)).toHaveLength(1);
      expect(text).toContain('alert "allow"');
      expect(text.match(/^hide_keyboard$/gm)).toHaveLength(1);
    });

    it('marks whatever else changes things, so that a replay stops there', async () => {
      const page = { id: 'p', title: 't', url: 'https://x.test/', visible: true };
      device = Object.assign(new FakeDevice(), {
        web: {
          pages: () => Promise.resolve([page]),
          evaluate: () =>
            Promise.resolve({ tag: 'a', text: 'Go', title: 't', url: page.url, elements: [] }),
        },
        network: {
          paths: () => Promise.resolve([{ via: 'bytes', sees: 'bytes' }]),
          start: () => Promise.resolve({ id: 'handle' }),
          read: () => Promise.resolve({ entries: [] }),
          stop: () => Promise.resolve({ entries: [] }),
        },
      });
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('webview', { action: 'pages' });
        await call('webview', { action: 'elements' });
        await call('webview', { action: 'click', selector: '#go' });
        await call('webview', { action: 'eval', js: 'secretWork()' });
        await call('network', { action: 'paths' });
        await call('network', { action: 'start', via: 'bytes' });
        await call('network', { action: 'read' });
        await call('network', { action: 'stop' });
        await call('perf_launch', { repeats: 1 });
      });
      const unrecorded = text.split('\n').filter((l) => l.startsWith('unrecorded'));
      expect(unrecorded).toEqual([
        'unrecorded "webview click"',
        'unrecorded "webview eval"',
        'unrecorded "network start"',
        'unrecorded "network stop"',
      ]);
      expect(text).not.toContain('secretWork');
    });

    it('marks an op that no list knows yet, by its name alone', async () => {
      const ctx = context();
      const call = callerOf(ctx);
      const op = flowRecorder(ctx).wrap(
        defineOp({
          name: 'new_op',
          title: 'x',
          description: 'x',
          input: z.object({}).loose(),
          output: z.object({}),
          annotations: ACT,
          run: () => Promise.resolve(reply('done', {})),
        }),
      );
      const { text } = await recorded(call, () => op.handler({ words: 'typed words' }));
      expect(text).toContain('unrecorded "new_op"');
      expect(text).not.toContain('typed words');
    });

    it('marks nothing for what only looks, picks the device, films it or runs the recording', async () => {
      device = Object.assign(new FakeDevice(), {
        recorder: {
          extension: 'mp4',
          start: () => Promise.resolve({ id: 'handle' }),
          stop: () => Promise.resolve({ files: [] }),
        },
      });
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('list_devices');
        await call('use_device', { device: device.serial });
        await call('simulator', { action: 'list' });
        await call('record', { action: 'start', file: join(dir, 'a.mp4') });
        await call('record', { action: 'stop' });
        await call('report', { action: 'write', dir: join(dir, 'report') });
        await call('screen');
        await call('perf_snapshot');
        await call('app', { action: 'state' }).catch(() => undefined);
        await call('launch_app');
      });
      expect(text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'launch !running',
      ]);
    });

    it('writes a launch that started the app as a start, and flags one that found it running', async () => {
      const call = callerOf(context());
      device.running = false;
      const started = await recorded(call, () => call('launch_app'), 'started.flow');
      expect(started.text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'stop',
        'launch',
      ]);
      const stopped = await recorded(
        call,
        async () => {
          await call('terminate_app');
          await call('launch_app');
        },
        'stopped.flow',
      );
      expect(stopped.text).toBe(started.text);
      device.running = true;
      await call('flow', { action: 'start' });
      await call('launch_app');
      const stop = await call('flow', { action: 'stop' });
      expect(stop.text).toContain('\nlaunch !running\n');
      expect(stop.data.flagged).toEqual([
        expect.stringMatching(/^step 1: running: the app was running, and a replay goes on/),
      ]);
    });

    it('launches a replay as the recording did: in its language, with the arguments and environment it names', async () => {
      const launched: unknown[] = [];
      device.apps = {
        launchWith: (app: string, o: unknown) => {
          launched.push([app, o]);
          return Promise.resolve();
        },
      } as unknown as AppManager;
      const call = callerOf(context());
      const { file, text } = await recorded(call, () => call('launch_app', { language: 'tr' }));
      expect(text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'launch language=tr',
      ]);
      await call('flow', { action: 'run', file });
      expect(launched).toEqual([
        ['dev.app', { language: 'tr' }],
        ['dev.app', { language: 'tr' }],
      ]);
      const named = join(dir, 'named.flow');
      writeFileSync(
        named,
        'app dev.app\nlaunch arg=-UITests arg=YES env="API_URL=https://a.test/?a=b"\n',
      );
      await call('flow', { action: 'run', file: named });
      expect(launched.at(-1)).toEqual([
        'dev.app',
        { args: ['-UITests', 'YES'], env: { API_URL: 'https://a.test/?a=b' } },
      ]);
    });

    it('writes a launch with restart, arguments or an environment as a start, whether the app ran or not', async () => {
      const launched: unknown[] = [];
      device.apps = {
        launchWith: (app: string, o: unknown) => {
          launched.push([app, o]);
          return Promise.resolve();
        },
      } as unknown as AppManager;
      const call = callerOf(context());
      const stepsOf = (text: string) => text.split('\n').filter((l) => l && !l.startsWith('app '));
      const how = { args: ['-UITests', 'YES'], env: { API_URL: 'https://a.test/' } };
      const launch = () => call('launch_app', how);
      device.running = false;
      const started = await recorded(call, launch, 'started.flow');
      expect(stepsOf(started.text)).toEqual([
        'stop',
        'launch arg=-UITests arg=YES env="API_URL=https://a.test/"',
      ]);
      device.running = true;
      const restarted = await recorded(call, launch, 'restarted.flow');
      expect(restarted.text).toBe(started.text);
      device.calls = [];
      await call('flow', { action: 'run', file: restarted.file });
      expect(device.calls.map((c) => c.name)).toContain('terminate');
      expect(launched.at(-1)).toEqual(['dev.app', how]);
      const plain = await recorded(call, () => call('launch_app', { restart: true }), 'plain.flow');
      expect(stepsOf(plain.text)).toEqual(['stop', 'launch']);
    });

    it('holds across the processes of a command line, on the device it began on', async () => {
      await callerOf(context())('flow', { action: 'start' });
      await callerOf(context())('tap', { selector: { text: 'Form' } });
      device = new FakeDevice('emulator-9999');
      device.screen = 'form';
      await callerOf(context())('assert', { text: 'Bilgiler' });
      device = new FakeDevice();
      const stop = await callerOf(context())('flow', { action: 'stop' });
      expect(stop.data.steps).toBe(1);
    });

    it('refuses a second start, a replay during a recording, and an empty or unnamed save', async () => {
      const call = callerOf(context());
      const stopped = await refusal(call('flow', { action: 'stop' }));
      expect(stopped.message).toContain('no recording');
      await call('flow', { action: 'start' });
      expect((await refusal(call('flow', { action: 'start' }))).message).toContain('running');
      expect(
        (await refusal(call('flow', { action: 'save', file: join(dir, 'e.flow') }))).message,
      ).toContain('nothing was recorded');
      await call('launch_app');
      expect((await refusal(call('flow', { action: 'save' }))).message).toContain('needs file');
      expect(
        (await refusal(call('flow', { action: 'save', file: join(dir, 'x.txt') }))).message,
      ).toContain('.flow');
      writeFileSync(join(dir, 'r.flow'), 'launch\n');
      expect(
        (await refusal(call('flow', { action: 'run', file: join(dir, 'r.flow') }))).message,
      ).toContain('stop the recording');
    });

    it('saves inside the state or project folder alone, and replaces a saved flow only when told to', async () => {
      const call = callerOf(context());
      const { file, text } = await recorded(call, () => call('launch_app'));
      expect((await refusal(call('flow', { action: 'save', file }))).message).toContain('exists');
      expect(readFileSync(file, 'utf8')).toBe(text);
      await call('flow', { action: 'save', file, overwrite: true });
      const outside = await refusal(call('flow', { action: 'save', file: join(dir, 'a.flow') }));
      expect(outside.code).toBe('POLICY_DENIED');
      expect(existsSync(join(dir, 'a.flow'))).toBe(false);
      symlinkSync(dir, join(dir, 'state', 'out'));
      const linked = await refusal(
        call('flow', { action: 'save', file: join(dir, 'state', 'out', 'a.flow') }),
      );
      expect(linked.code).toBe('POLICY_DENIED');
      expect(existsSync(join(dir, 'a.flow'))).toBe(false);
    });
  });

  it('writes a flow its own parser reads back', async () => {
    device.screen = 'login';
    const call = callerOf(context());
    const { text } = await recorded(call, async () => {
      await call('type_text', {
        text: SECRET,
        selector: { id: 'pass' },
        replace: true,
        submit: true,
      });
      await call('wait_for', { id: 'greeting', timeoutMs: 800 });
      await call('assert', { text: 'Merhaba', check: 'absent', expect: false });
      await call('scroll_to', { selector: { id: 'greeting' }, direction: 'down', maxSwipes: 3 });
      await call('swipe', { direction: 'left', distance: 200 });
      await call('gesture', { kind: 'long_press', selector: { id: 'greeting' }, durationMs: 300 });
      await call('gesture', { kind: 'double_tap', selector: { id: 'greeting' } });
      await call('terminate_app');
    });
    const f = parseFlow(text);
    expect(f.steps.map((s) => s.action)).toEqual([
      'type',
      'wait_for',
      'assert',
      'scroll_to',
      'swipe',
      'long_press',
      'double_tap',
      'stop',
    ]);
    expect(text).toContain('swipe left distance=200 screen=1080x2400 !coordinates');
  });
});
