import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider } from '@appdyno/core';
import { decodePng, encodePng } from '@appdyno/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ServerContext } from '../src/context.js';
import { DEFAULT_POLICY } from '../src/policy.js';
import { reportFor } from '../src/report.js';
import { ACT, defineOp, READ, reply, ToolError, type ToolAnnotations } from '../src/tool.js';
import { FakeDevice } from './fake-device.js';
import { callerOf } from './helpers.js';

const SECRET = 's3cr3t-pass';

function connect(device = new FakeDevice()) {
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true, model: 'Fake' }],
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext({ ...DEFAULT_POLICY, secrets: [SECRET] }, [provider], {
    app: 'dev.app',
    measurements: mkdtempSync(join(tmpdir(), 'appdyno-measure-')),
  });
  const call = callerOf(ctx);
  return { ctx, call, device };
}

/** A device whose images are real PNGs: white, one pixel of tap units per pixel. */
class ImagingDevice extends FakeDevice {
  override async screenshot(): ReturnType<FakeDevice['screenshot']> {
    const img = {
      width: 1080,
      height: 2400,
      channels: 3 as const,
      data: new Uint8Array(1080 * 2400 * 3).fill(255),
    };
    const data = encodePng(img);
    return { meta: { w: 1080, h: 2400, format: 'png', bytes: data.length }, data };
  }
}

describe('report', () => {
  let dir: string;
  beforeEach(() => {
    process.env.APPDYNO_STATE_DIR = mkdtempSync(join(tmpdir(), 'appdyno-state-'));
    dir = join(mkdtempSync(join(tmpdir(), 'appdyno-report-')), 'session');
  });

  it('writes steps, screens and images, and loads nothing from anywhere', async () => {
    const { call } = connect();
    await call('report', { action: 'start', dir });
    await call('tap', { selector: { text: 'Form' } });
    await call('screen');
    const r = await call('report', { action: 'stop' });
    expect(r.data).toMatchObject({ steps: 2, file: join(dir, 'index.html') });
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toContain('Content-Security-Policy');
    expect(html).toMatch(/>1<\/span>tap/);
    expect(html).toMatch(/>2<\/span>screen/);
    expect(html).toContain('Bilgiler');
    expect(readdirSync(join(dir, 'shots'))).toEqual(['0001.jpg']);
    expect(html).toContain('src="shots/0001.jpg"');
    expect(html).not.toMatch(/<script|<link|https?:\/\/|<iframe/i);
    // ended: nothing more is kept
    await expect(call('report', { action: 'stop' })).rejects.toThrow(/no report is open/);
  });

  it('keeps what an install answered on the phone', async () => {
    const device = Object.assign(new FakeDevice(), {
      apps: { install: async () => ['passed a Play Protect warning for dev.app'] },
    });
    const { call } = connect(device);
    await call('report', { action: 'start', dir });
    await call('app', { action: 'install', path: '/tmp/a.apk' });
    await call('report', { action: 'stop' });
    for (const f of ['index.html', 'steps.jsonl'])
      expect(readFileSync(join(dir, f), 'utf8')).toContain(
        'passed a Play Protect warning for dev.app',
      );
  });

  it('keeps every element of a screen an answer folds', async () => {
    const device = new FakeDevice();
    const { call } = connect(device);
    device.screen = 'settings';
    await call('report', { action: 'start', dir });
    await call('report', { action: 'write' });
    const html = readFileSync(join(dir, 'index.html'), 'utf8');
    expect(html).toMatch(/10 elements/);
    expect(html).toContain('text &#34;Bluetooth&#34; 300,430');
    expect(html).not.toContain('inside rows');
    device.screen = 'doubled';
    await call('report', { action: 'write' });
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toMatch(
      /button &#34;General&#34; 540,350/,
    );
  });

  it('hides secrets in every text, and never writes what was typed', async () => {
    const { call, ctx } = connect();
    await call('report', { action: 'start', dir });
    await call('tap', { selector: { text: 'Form' } });
    await call('type_text', { selector: { text: 'Adınız' }, text: 'hidden-words' });
    await call('open_link', { url: `app://x?token=abc123&secret=${SECRET}` }).catch(
      () => undefined,
    );
    await ctx.end();
    const all =
      readFileSync(join(dir, 'index.html'), 'utf8') + readFileSync(join(dir, 'steps.jsonl'));
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain('abc123');
    expect(all).not.toContain('hidden-words');
    expect(all).toContain('(12 characters)');
  });

  it('shows by its length what it does not know to name something, whatever the op', async () => {
    const { ctx, call } = connect();
    await call('report', { action: 'start', dir });
    const made = (annotations: ToolAnnotations) =>
      reportFor(ctx).wrap(
        defineOp({
          name: 'new_op',
          title: 'x',
          description: 'x',
          input: z.object({}).loose(),
          output: z.object({}),
          annotations,
          run: async () => reply('done', {}),
        }),
      );
    await made(ACT).handler({
      words: 'hidden-words',
      deep: { list: ['hidden-deep'] },
      app: 'dev.app',
      selector: { text: 'Form' },
    });
    await call('steps', {
      steps: [
        { action: 'wait_for', text: 'Form', timeoutMs: 300 },
        { action: 'type_text', text: 'hidden-step', x: 5, y: 5 },
      ],
    });
    await call('flow', { action: 'run', file: '/no/such.flow', params: ['A=hidden-param'] }).catch(
      () => undefined,
    );
    await made(READ).handler({ text: 'on the screen' });
    await call('report', { action: 'stop' });
    const journal = readFileSync(join(dir, 'steps.jsonl'), 'utf8');
    for (const typed of ['hidden-words', 'hidden-deep', 'hidden-step', 'hidden-param'])
      expect(journal).not.toContain(typed);
    expect(journal).toContain('(12 characters)');
    for (const named of ['dev.app', '"text":"Form"', 'on the screen', '"action":"wait_for"'])
      expect(journal).toContain(named);
  });

  it('paints over an element that holds a secret, in the image too', async () => {
    const device = new ImagingDevice();
    const { call } = connect(device);
    device.screen = 'login';
    await call('report', { action: 'start', dir });
    await call('tap', { selector: { text: 'Add', index: 0 } });
    await call('report', { action: 'write' });
    const name = readdirSync(join(dir, 'shots'))[0]!;
    expect(name).toBe('0001.png');
    const img = decodePng(readFileSync(join(dir, 'shots', name)))!;
    const red = (x: number, y: number) => img.data[(y * img.width + x) * img.channels];
    expect(red(540, 950)).toBe(0); // the greeting holding the secret
    expect(red(540, 350)).toBe(0); // the password field
    expect(red(540, 150)).toBe(255); // a field holding neither
  });

  it('leaves out an image it cannot paint over', async () => {
    const { call, device } = connect();
    device.screen = 'login';
    await call('report', { action: 'start', dir });
    await call('tap', { selector: { text: 'Add', index: 0 } });
    const r = await call('report', { action: 'write' });
    expect(existsSync(join(dir, 'shots'))).toBe(true);
    expect(readdirSync(join(dir, 'shots'))).toEqual([]);
    expect(readFileSync(String(r.data.file), 'utf8')).not.toContain('<img');
  });

  it('writes a report of the screen as it is, with no start', async () => {
    const { call } = connect();
    const r = await call('report', { action: 'write', dir });
    const html = readFileSync(String(r.data.file), 'utf8');
    expect(html).toContain('The screen now');
    expect(html).toContain('none kept');
    expect(existsSync(join(dir, 'shots', 'now.jpg'))).toBe(true);
  });

  it('refuses a second report, and writes the open one at the session end', async () => {
    const { call, ctx } = connect();
    await call('report', { action: 'start', dir });
    await expect(call('report', { action: 'start', dir })).rejects.toBeInstanceOf(ToolError);
    await call('tap', { selector: { text: 'Form' } });
    expect(await ctx.end()).toEqual([]);
    expect(readFileSync(join(dir, 'index.html'), 'utf8')).toMatch(/>1<\/span>tap/);
  });
});
