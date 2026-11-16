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
        const { data } = await call('read_screen', { selector: { text: 'Wi-Fi' } });
        await call('tap_screen', { ref: must(data.matches[0], 'a match').ref });
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
        const { data } = await call('read_screen', {
          selector: { role: 'button', text: 'Camera' },
        });
        await call('tap_screen', {
          ref: must((data.matches as { ref: string }[])[0], 'a match').ref,
        });
      });
      expect(text).toContain('tap role=button text="Camera"');
    });

    it('logs each action with the best selector, whatever named its target', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('launch_app');
        const home = await call('read_screen');
        await call('tap_screen', { ref: refOf(home.text, 'Form') });
        await call('type_text', { text: 'Ayşe', selector: { id: 'name' } });
        await call('press_key', { key: 'back' });
        await call('open_link', { url: 'app://x' });
        await call('set_device', { name: 'location', value: '41,29' });
        await call('swipe_screen', { direction: 'up' });
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
      const { text } = await recorded(call, () => call('tap_screen', { x: 500, y: 350 }));
      expect(text).toContain('tap role=button text="Form"\n');
    });

    it('records a tap on a ref only screen raw gives as what is at its middle', async () => {
      const call = callerOf(context());
      const { data } = await call('read_screen', { raw: true });
      const root = must(
        data.nodes?.find((n) => n.type === 'android.widget.FrameLayout')?.ref,
        'the root ref',
      );
      const { text } = await recorded(call, () => call('tap_screen', { ref: root }));
      expect(text).toContain('tap x=540 y=1200 screen=1080x2400 !coordinates\n');
    });

    it('flags coordinates when nothing is there, with the screen they hold for', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('tap_screen', { x: 500, y: 2000 }));
      expect(text).toContain('tap x=500 y=2000 screen=1080x2400 !coordinates\n');
    });

    it('records an ambiguous target with its index, flagged, and says so', async () => {
      device.screen = 'login';
      const call = callerOf(context());
      await call('run_flow', { action: 'record' });
      const s = await call('read_screen');
      const second = must(
        [...s.text.matchAll(/(@[a-z0-9-]+) button "Add"/g)][1]?.[1],
        'the second Add',
      );
      await call('tap_screen', { ref: second });
      const stop = await call('run_flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Add" index=1 !ambiguous');
      expect(stop.text).toContain('look at step 1: ambiguous');
      expect(stop.data.flagged).toEqual(['step 1: ambiguous']);
    });

    it('keeps out of the file what is not an action, or did not happen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('read_screen');
        await call('read_screen', { selector: { text: 'Form' } });
        await call('take_screenshot');
        await call('list_devices', { selected: true });
        await refusal(call('tap_screen', { selector: { text: 'Nothing like it' } }));
        await refusal(call('check_element', { selector: { text: 'Nothing like it' } }));
        await refusal(
          call('check_element', { selector: { text: 'Nothing like it' }, timeoutMs: 300 }),
        );
        await call('check_element', { selector: { text: 'Ana sayfa' } });
      });
      expect(text).toBe('app dev.app\n\nassert text="Ana sayfa"\n');
    });

    it('logs every step of a `steps` call, each named on its own screen', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () =>
        call('run_steps', {
          steps: [
            { tool: 'tap_screen', selector: { text: 'Form' } },
            { tool: 'check_element', selector: { id: 'name' }, timeoutMs: 5000 },
            { tool: 'type_text', text: 'x', selector: { id: 'name' } },
            { tool: 'tap_screen', selector: { text: 'Gönder' } },
            {
              tool: 'check_element',
              selector: { id: 'result' },
              check: 'text',
              equals: 'Gönderildi',
            },
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
      await call('run_flow', { action: 'record' });
      await refusal(
        call('run_steps', {
          steps: [
            { tool: 'tap_screen', selector: { text: 'Form' } },
            { tool: 'tap_screen', selector: { text: 'Nothing like it' } },
          ],
        }),
      );
      const stop = await call('run_flow', { action: 'stop' });
      expect(stop.text).toContain('tap role=button text="Form"');
      expect(stop.text).not.toContain('Nothing like it');
    });

    it('marks an action with no step, so that a replay cannot pass without it', async () => {
      const call = callerOf(context());
      const { text } = await recorded(call, () => call('swipe_screen', { scale: 2 }));
      expect(text).toContain('unrecorded "swipe_screen scale"');
    });

    describe('an action with no step', () => {
      const NOT = (what: string) =>
        `not recorded: ${what}. A flow has no step for it, so a replay stops there`;
      /** The line under what the action says it did. */
      const second = (r: { text: string }) => must(r.text.split('\n')[1], 'a second line');

      it('says so in its own answer, in a line, and again at the end of the recording', async () => {
        const call = callerOf(context());
        await call('run_flow', { action: 'record' });
        const pinch = await call('swipe_screen', { scale: 2, read: 'full' });
        expect(pinch.text.split('\n')[0]).toBe(pinch.data.done);
        expect(second(pinch)).toBe(NOT('swipe_screen scale'));
        expect(pinch.text.split('\n').length).toBeGreaterThan(2);
        const path = [
          { x: 100, y: 100, t: 0 },
          { x: 300, y: 500, t: 200 },
        ];
        const drawn = await call('swipe_screen', { pointers: [path] });
        expect(second(drawn)).toBe(NOT('swipe_screen pointers'));
        const stop = await call('run_flow', { action: 'stop' });
        expect(stop.text).toContain('step 1: not recorded: swipe_screen scale');
        expect(stop.text).toContain('step 2: not recorded: swipe_screen pointers');
      });

      it('adds nothing to an action a recording keeps, nor to one made with no recording', async () => {
        const call = callerOf(context());
        expect((await call('swipe_screen', { scale: 2 })).text).not.toContain('not recorded');
        await call('run_flow', { action: 'record' });
        expect((await call('tap_screen', { selector: { text: 'Form' } })).text).not.toContain(
          'not recorded',
        );
        expect((await call('set_device', { name: 'clipboard' })).text).not.toContain(
          'not recorded',
        );
      });
    });

    describe('what had no step', () => {
      const page = { id: 'p7', title: 'Pay', url: 'https://x.test/pay', visible: true };
      const pushed: unknown[] = [];
      const scripts: string[] = [];
      let found = 0;
      beforeEach(() => {
        pushed.length = 0;
        scripts.length = 0;
        found = 0;
        device = Object.assign(new FakeDevice(), {
          web: {
            pages: () => Promise.resolve([page]),
            evaluate: (_page: unknown, js: string) => {
              scripts.push(js);
              return Promise.resolve({ tag: 'a', text: 'Go' });
            },
          },
          events: {
            pushRoutes: () =>
              Promise.resolve([
                {
                  type: 'alert',
                  route: 'by hand',
                  fields: ['title', 'body', 'data'],
                  template: '',
                },
                { type: 'background', route: 'by hand', fields: ['data'], template: '' },
              ]),
            push: (_app: string, push: unknown) => {
              pushed.push(push);
              return Promise.resolve('pushed');
            },
          },
        });
        device.audit = () =>
          Promise.resolve({
            engine: 'rules',
            issues: Array<{ type: string; rule: string; message: string }>(found).fill({
              type: 'contrast',
              rule: 'TextContrast',
              message: 'low',
            }),
            truncated: false,
            elapsedMs: 1,
          }) as ReturnType<FakeDevice['audit']>;
      });
      const did = (name: string) =>
        device.calls.filter((c) => c.name === name).map((c) => c.args[0]);

      it('records a push, a turn, a web click, a text on the clipboard and an audit, and replays each', async () => {
        const call = callerOf(context());
        found = 2;
        const { text, file } = await recorded(call, async () => {
          // a listing sent nothing, and a read of the clipboard changed nothing
          await call('send_push', {});
          await call('set_device', { name: 'clipboard' });
          await call('send_push', { title: 'Order', body: 'On its way', data: { orderId: '43' } });
          await call('send_push', { type: 'background', data: { link: 'app://x?a=b' } });
          await call('set_device', { name: 'orientation', value: 'landscape_left' });
          await call('inspect_app', { action: 'web_click', selector: '#pay' });
          await call('inspect_app', { action: 'web_click', selector: 'a[href]', page: 'p7' });
          await call('inspect_app', { action: 'web_click', selector: '#pay', page: 'Pay' });
          await call('set_device', { name: 'clipboard', value: 'Merhaba dünya' });
          await call('check_screen', { check: 'accessibility', types: ['contrast', 'hitRegion'] });
        });
        expect(text.trim().split('\n').slice(2)).toEqual([
          'push alert title=Order body="On its way" data="orderId=43"',
          'push background data="link=app://x?a=b"',
          'setting orientation landscape_left',
          'web_click "#pay"',
          'web_click "a[href]"',
          'web_click "#pay" page=Pay',
          'clipboard "Merhaba dünya"',
          'audit types="contrast,hitRegion" max=2 !review',
        ]);
        const sent = [...pushed];
        const [turned] = did('setOrientation');
        device.calls.length = 0;
        pushed.length = 0;
        scripts.length = 0;
        const out = await call('run_flow', { action: 'run', file });
        expect(out.text).toContain('passed: 8 steps');
        expect(pushed).toEqual(sent);
        expect(pushed[1]).toMatchObject({ type: 'background', data: { link: 'app://x?a=b' } });
        expect(did('setOrientation')).toEqual([turned]);
        expect(scripts).toHaveLength(3);
        expect(did('setClipboard')).toEqual(['Merhaba dünya']);
        // one more issue than the recording found fails the step, until a person sets the number
        found = 3;
        const e = await refusal(call('run_flow', { action: 'run', file }));
        expect(e.message).toContain('step 8 failed: audit');
        expect(e.message).toContain('this step allows 2');
      });

      it('says at a save that the number an audit kept is for a person to set', async () => {
        const call = callerOf(context());
        await call('run_flow', { action: 'record' });
        await call('check_screen', { check: 'accessibility' });
        const stop = await call('run_flow', { action: 'stop' });
        expect(stop.text).toContain('audit max=0 !review');
        expect(stop.text).toContain(
          'look at step 1: review: the number is what the recording found',
        );
      });

      it('keeps a push whose data name holds an equals sign unrecorded: no line reads back as it', async () => {
        const call = callerOf(context());
        const { text } = await recorded(call, () =>
          call('send_push', { type: 'background', data: { 'a=b': 'c' } }),
        );
        expect(text).toContain('unrecorded "send_push"');
      });

      it('records a drag from its target to where it was let go, an element or a point, and replays it', async () => {
        const call = callerOf(context());
        const { text, file } = await recorded(call, async () => {
          const { data } = await call('read_screen', { selector: { text: 'İzin' } });
          const ref = must(data.matches[0], 'a match').ref;
          await call('swipe_screen', { selector: { text: 'Form' }, to: { ref } });
          await call('swipe_screen', {
            selector: { text: 'Form' },
            to: { x: 500, y: 900 },
            holdMs: 400,
            durationMs: 800,
          });
          await call('swipe_screen', { x: 540, y: 2000, to: { selector: { text: 'Form' } } });
        });
        const lines = text.trim().split('\n').slice(2);
        expect(lines).toEqual([
          'drag role=button text="Form" to="role=button text=\\"İzin\\""',
          'drag role=button text="Form" to="500,900" holdMs=400 durationMs=800 screen=1080x2400 !coordinates',
          'drag to="role=button text=\\"Form\\"" x=540 y=2000 screen=1080x2400 !coordinates',
        ]);
        const drags = () =>
          device.calls.filter((c) => c.name === 'act').map((c) => JSON.stringify(c.args[0]));
        const made = drags();
        expect(made).toHaveLength(3);
        device.calls.length = 0;
        await call('run_flow', { action: 'run', file });
        expect(drags()).toEqual(made);
      });

      it('refuses a drag line with no place to let go, or a point not flagged as one', () => {
        expect(() => parseFlow('drag id=card\n')).toThrow('drag needs to');
        expect(() => parseFlow('drag id=card to=10,20\n')).toThrow('is flagged !coordinates');
        expect(() => parseFlow('drag id=card to="colour=red"\n')).toThrow('to is x,y or id=');
        expect(() => parseFlow('push alert data=nokey\n')).toThrow('data is NAME=value');
        expect(parseFlow('drag id=card to="id=bin"\n').steps).toHaveLength(1);
      });
    });

    it('leaves a window and a person out: neither is a step of the app, nor stops a replay', async () => {
      const call = callerOf(context());
      await expect(
        recorded(call, async () => {
          await call('show_mirror', { action: 'status' });
          await call('ask_person', { reason: 'Face ID', timeoutS: 1 });
        }),
      ).rejects.toThrow('nothing was recorded yet');
    });

    it('records an answered alert and a closed keyboard, and neither where nothing was there', async () => {
      device = new WithKeyboard();
      device.permissionUp = true;
      const call = callerOf(context());
      const { text } = await recorded(call, async () => {
        await call('answer_alert', { answer: 'allow' });
        await refusal(call('answer_alert', { answer: 'allow' }));
        await call('read_screen');
        await call('press_key', { key: 'hide_keyboard' });
        await call('press_key', { key: 'hide_keyboard' });
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
      let clicked = '';
      const { text } = await recorded(call, async () => {
        await call('inspect_app', { action: 'web_pages' });
        await call('inspect_app', { action: 'web_elements' });
        clicked = (await call('inspect_app', { action: 'web_click', selector: '#go' })).text;
        await call('inspect_app', { action: 'web_eval', js: 'secretWork()' });
        await call('capture_network', { action: 'paths' });
        await call('capture_network', { action: 'start', via: 'bytes' });
        await call('capture_network', { action: 'read' });
        await call('capture_network', { action: 'stop' });
        await call('measure_performance', { metric: 'launch', repeats: 1 });
      });
      const unrecorded = text.split('\n').filter((l) => l.startsWith('unrecorded'));
      expect(unrecorded).toEqual([
        'unrecorded "inspect_app web_eval"',
        'unrecorded "capture_network start"',
        'unrecorded "capture_network stop"',
      ]);
      expect(text).toContain('web_click "#go"');
      expect(clicked).not.toContain('not recorded');
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
        await call('manage_simulator', { action: 'list' });
        await call('record_session', {
          kind: 'video',
          action: 'start',
          file: join(dir, 'shots', 'a.mp4'),
        });
        await call('record_session', { kind: 'video', action: 'stop' });
        await call('record_session', {
          kind: 'report',
          action: 'write',
          dir: join(dir, 'shots', 'report'),
        });
        await call('read_screen');
        await call('measure_performance', { metric: 'snapshot' });
        await call('manage_app', { action: 'state' }).catch(() => undefined);
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
          await call('manage_app', { action: 'stop' });
          await call('launch_app');
        },
        'stopped.flow',
      );
      expect(stopped.text).toBe(started.text);
      device.running = true;
      await call('run_flow', { action: 'record' });
      await call('launch_app');
      const stop = await call('run_flow', { action: 'stop' });
      expect(stop.text).toContain('\nlaunch !running\n');
      expect(stop.text).toMatch(
        /^stopped: 1 steps, kept until the next record; run_flow save with file writes them\n/,
      );
      expect(stop.data.flagged).toEqual([
        expect.stringMatching(
          /^step 1: running: the app was already running, .*record launch_app restart: true in its place$/,
        ),
      ]);
    });

    it('saves at stop to the file it is given, and keeps a recording whose file is refused', async () => {
      const call = callerOf(context());
      const file = join(dir, 'state', 'tapped.flow');
      await call('run_flow', { action: 'record' });
      const home = await call('read_screen');
      await call('tap_screen', { ref: refOf(home.text, 'Form') });
      // a path refused before the stop: the recording goes on
      expect(
        (await refusal(call('run_flow', { action: 'stop', file: join(dir, 'state', 'a.txt') })))
          .code,
      ).toBe('INVALID_ARGUMENT');
      const stop = await call('run_flow', { action: 'stop', file });
      expect(stop.text).toMatch(new RegExp(`^stopped, and saved 1 steps to ${file}\n`));
      expect(readFileSync(file, 'utf8')).toContain('tap ');
      // a file there already: stopped all the same, and what it held is still to save
      await call('run_flow', { action: 'record' });
      await call('press_key', { key: 'back' });
      const there = await refusal(call('run_flow', { action: 'stop', file }));
      expect(there.message).toMatch(
        /exists: overwrite true replaces it; the recording stopped, and its 1 steps are kept: run_flow save writes them$/,
      );
      expect(
        (await call('run_flow', { action: 'save', file: join(dir, 'state', 'again.flow') })).text,
      ).toMatch(/^saved 1 steps/);
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
      await call('run_flow', { action: 'run', file });
      expect(launched).toEqual([
        ['dev.app', { language: 'tr' }],
        ['dev.app', { language: 'tr' }],
      ]);
      const named = join(dir, 'named.flow');
      writeFileSync(
        named,
        'app dev.app\nlaunch arg=-UITests arg=YES env="API_URL=https://a.test/?a=b"\n',
      );
      await call('run_flow', { action: 'run', file: named });
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
      await call('run_flow', { action: 'run', file: restarted.file });
      expect(device.calls.map((c) => c.name)).toContain('terminate');
      expect(launched.at(-1)).toEqual(['dev.app', how]);
      const plain = await recorded(call, () => call('launch_app', { restart: true }), 'plain.flow');
      expect(stepsOf(plain.text)).toEqual(['stop', 'launch']);
    });

    it('writes a launch that put the view probe in as a start with it, and replays it so', async () => {
      const launched: unknown[] = [];
      device.apps = {
        viewProbe: true,
        launchWith: (app: string, o: unknown) => {
          launched.push([app, o]);
          return Promise.resolve();
        },
      } as unknown as AppManager;
      const call = callerOf(context());
      const { file, text } = await recorded(call, () => call('launch_app', { probe: true }));
      expect(text.split('\n').filter((l) => l && !l.startsWith('app '))).toEqual([
        'stop',
        'launch probe',
      ]);
      await call('run_flow', { action: 'run', file });
      expect(launched).toEqual([
        ['dev.app', { probe: true }],
        ['dev.app', { probe: true }],
      ]);
    });

    it('holds across the processes of a command line, on the device it began on', async () => {
      await callerOf(context())('run_flow', { action: 'record' });
      await callerOf(context())('tap_screen', { selector: { text: 'Form' } });
      device = new FakeDevice('emulator-9999');
      device.screen = 'form';
      await callerOf(context())('check_element', { selector: { text: 'Bilgiler' } });
      device = new FakeDevice();
      const stop = await callerOf(context())('run_flow', { action: 'stop' });
      expect(stop.data.steps).toBe(1);
    });

    it('refuses a second start, a replay during a recording, and an empty or unnamed save', async () => {
      const call = callerOf(context());
      const stopped = await refusal(call('run_flow', { action: 'stop' }));
      expect(stopped.message).toContain('no recording');
      await call('run_flow', { action: 'record' });
      expect((await refusal(call('run_flow', { action: 'record' }))).message).toContain('running');
      expect(
        (await refusal(call('run_flow', { action: 'save', file: join(dir, 'e.flow') }))).message,
      ).toContain('nothing was recorded');
      await call('launch_app');
      expect((await refusal(call('run_flow', { action: 'save' }))).message).toContain('needs file');
      expect(
        (await refusal(call('run_flow', { action: 'save', file: join(dir, 'x.txt') }))).message,
      ).toContain('.flow');
      writeFileSync(join(dir, 'r.flow'), 'launch\n');
      expect(
        (await refusal(call('run_flow', { action: 'run', file: join(dir, 'r.flow') }))).message,
      ).toContain('stop the recording');
    });

    it('saves inside the state or project folder alone, and replaces a saved flow only when told to', async () => {
      const call = callerOf(context());
      const { file, text } = await recorded(call, () => call('launch_app'));
      expect((await refusal(call('run_flow', { action: 'save', file }))).message).toContain(
        'exists',
      );
      expect(readFileSync(file, 'utf8')).toBe(text);
      await call('run_flow', { action: 'save', file, overwrite: true });
      const outside = await refusal(
        call('run_flow', { action: 'save', file: join(dir, 'a.flow') }),
      );
      expect(outside.code).toBe('POLICY_DENIED');
      expect(existsSync(join(dir, 'a.flow'))).toBe(false);
      symlinkSync(dir, join(dir, 'state', 'out'));
      const linked = await refusal(
        call('run_flow', { action: 'save', file: join(dir, 'state', 'out', 'a.flow') }),
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
      await call('check_element', { selector: { id: 'greeting' }, timeoutMs: 800 });
      await call('check_element', {
        selector: { text: 'Merhaba' },
        check: 'absent',
        expect: false,
      });
      await call('swipe_screen', { until: { id: 'greeting' }, direction: 'down', maxSwipes: 3 });
      await call('swipe_screen', { direction: 'left', distance: 200 });
      await call('tap_screen', { selector: { id: 'greeting' }, holdMs: 300 });
      await call('tap_screen', { selector: { id: 'greeting' }, count: 2 });
      await call('manage_app', { action: 'stop' });
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
