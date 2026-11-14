import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type AuditResult } from '@appdyno/protocol';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { shownSize } from '@appdyno/ops';
import { serialsFrom, setup, FORM_BUTTON } from './window-setup.js';

const home = mkdtempSync(join(tmpdir(), 'appdyno-window-flow-'));

vi.mock('node:os', async (real) => ({
  ...(await real<typeof import('node:os')>()),
  homedir: () => home,
}));

afterAll(() => rmSync(home, { recursive: true, force: true }));

serialsFrom(6500);

describe('the size a click is measured on', () => {
  const PHONE = { w: 1080, h: 2400 };

  it("is the device's own: an app's window may leave out a bar", () => {
    expect(shownSize(PHONE, { w: 1080, h: 2274 })).toEqual(PHONE);
  });

  it('turns with the screen, as a device says only how it started', () => {
    expect(shownSize(PHONE, { w: 2400, h: 1080 })).toEqual({ w: 2400, h: 1080 });
  });

  it('has what there is', () => {
    expect(shownSize(PHONE, undefined)).toEqual(PHONE);
    expect(shownSize(undefined, PHONE)).toEqual(PHONE);
    expect(shownSize(undefined, undefined)).toBeUndefined();
  });
});

describe('the element under the pointer', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const issue = (b: [number, number, number, number]): AuditResult => ({
    engine: 'rules',
    truncated: false,
    elapsedMs: 3,
    issues: [{ type: 'contrast', rule: 'android.textContrast', message: 'text contrast 2.1:1', b }],
  });

  const opened = async () => {
    const t = setup();
    t.device.audit = () => Promise.resolve(issue([100, 310, 200, 340]));
    t.flow.onWindow({ op: 'inspect', on: true });
    await t.settle();
    return t;
  };
  const element = (t: ReturnType<typeof setup>) => t.told.filter((m) => m.op === 'element').at(-1);

  it('asks of an audit only what the platform has', async () => {
    const t = setup();
    const audit = vi.fn(() => Promise.resolve(issue([100, 310, 200, 340])));
    t.device.audit = audit;
    const screen = { ...t.device.platformScreen, contrastAudits: ['contrast'] };
    Object.assign(t.device, { platformScreen: screen });
    t.flow.onWindow({ op: 'inspect', on: true });
    await t.settle();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 350 / 2400 });
    await t.settle();
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ types: ['contrast'] }));
  });

  it('says what it is, what a click there writes and where to draw it', async () => {
    const t = await opened();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 350 / 2400 });
    await t.settle();
    expect(element(t)).toMatchObject({
      role: 'button',
      label: 'Form',
      selector: 'role=button text="Form"',
      tap: 'tap role=button text="Form"',
      rect: { x: 0, y: 300 / 2400, w: 1, h: 100 / 2400 },
      contrast: ['text contrast 2.1:1'],
    });
    expect((element(t) as { ref: string }).ref).toMatch(/^@/);
  });

  it('asks a device nothing for a hover', async () => {
    const t = await opened();
    t.flow.onWindow({ op: 'inspect', on: false });
    await t.settle();
    const reads = t.device.calls.length;
    for (let i = 0; i < 20; i++) t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
    await t.settle();
    expect(t.device.calls.length).toBe(reads);
  });

  it('audits nothing while a recording runs: a read behind an audit would name a click on the screen it made', async () => {
    const t = await opened();
    let audits = 0;
    t.device.audit = () => {
      audits++;
      return Promise.resolve(issue([100, 310, 200, 340]));
    };
    await t.toggle();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
    await t.settle();
    t.device.screen = 'form';
    await t.settle();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
    await t.settle();
    expect(audits).toBe(0);
    expect(element(t)).toMatchObject({ contrast: [], contrastNote: 'Not read while recording' });
    await t.toggle();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
    await t.settle();
    expect(audits).toBe(1);
  });

  it('waits for the pointer to rest before it audits', async () => {
    const t = await opened();
    let audits = 0;
    t.device.audit = () => {
      audits++;
      return Promise.resolve(issue([100, 310, 200, 340]));
    };
    for (let i = 0; i < 6; i++) {
      t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(audits).toBe(0);
    await t.settle();
    expect(audits).toBe(1);
  });

  it('says a click is named by the screen it landed on, with the pointer resting on it first', async () => {
    const t = await opened();
    // an audit as a device has it: reads wait behind it, in one queue
    let done: () => void = () => undefined;
    let auditing = false;
    t.device.audit = async () => {
      auditing = true;
      await new Promise<void>((r) => (done = r));
      auditing = false;
      return issue([100, 310, 200, 340]);
    };
    const tree = t.device.tree.bind(t.device);
    t.device.tree = async () => {
      while (auditing) await new Promise((r) => setTimeout(r, 20));
      return tree();
    };
    await t.toggle();
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 350 / 2400 });
    await t.settle();
    expect(auditing).toBe(false);
    await t.click(FORM_BUTTON.x, FORM_BUTTON.y);
    expect(t.lines().at(-1)).toBe('tap role=button text="Form"');
    done();
  });

  it('reads contrast once per screen, and says when it could not', async () => {
    const t = await opened();
    let audits = 0;
    t.device.audit = () => {
      audits++;
      return Promise.reject(new Error('this device has no audit'));
    };
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.14 });
    t.flow.onWindow({ op: 'hover', x: 0.5, y: 0.15 });
    await t.settle();
    expect(audits).toBe(1);
    expect(element(t)).toMatchObject({ contrastNote: 'this device has no audit' });
  });

  it('copies what names it, and leaves the device alone', async () => {
    const t = await opened();
    const acts = t.device.calls.filter((c) => c.name === 'act').length;
    t.flow.onWindow({ op: 'pick', x: 0.5, y: 350 / 2400, as: 'copy' });
    expect(t.told.at(-2)).toEqual({ op: 'copyText', text: 'role=button text="Form"' });
    expect(t.device.calls.filter((c) => c.name === 'act')).toHaveLength(acts);
  });

  it('adds an assertion to a recording, by what the element says where its words do not name it', async () => {
    const t = await opened();
    t.device.screen = 'sent';
    await t.settle();
    await t.toggle();
    t.flow.onWindow({ op: 'pick', x: 0.5, y: 750 / 2400, as: 'assert' });
    await t.settle();
    expect(t.lines().at(-1)).toBe('assert id=result check=text equals="Gönderildi"');
    t.flow.onWindow({ op: 'pick', x: 0.5, y: 150 / 2400, as: 'assert' });
    await t.settle();
    expect(t.lines().at(-1)).toBe('assert text="Bilgiler"');
  });

  it('asks for a recording before an assertion', async () => {
    const t = await opened();
    t.flow.onWindow({ op: 'pick', x: 0.5, y: 0.14, as: 'assert' });
    expect(t.notes().at(-1)).toBe('Start a recording first');
  });

  it('says so of a place with nothing named', async () => {
    const t = await opened();
    t.flow.onWindow({ op: 'pick', x: 0.5, y: 0.9, as: 'copy' });
    expect(t.notes().at(-1)).toBe('Nothing is named there');
  });
});

describe('the Accessibility pane', () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  const found: AuditResult = {
    engine: 'rules',
    truncated: false,
    elapsedMs: 3,
    issues: [
      {
        type: 'contrast',
        rule: 'android.textContrast',
        message: 'text contrast 2.1:1',
        b: [0, 300, 1080, 400],
        element: { c: 'android.widget.Button', t: 'Form' },
      },
      { type: 'hitRegion', rule: 'android.touchTarget', message: 'touch target 30x30 dp' },
    ],
  };
  const shown = () => {
    const t = setup();
    const audit = vi.fn((_o?: { types?: string[] }) => Promise.resolve(found));
    t.device.audit = audit;
    t.flow.onWindow({ op: 'paneWatch', pane: 'accessibility', on: true });
    return { ...t, audit, audits: () => t.told.filter((m) => m.op === 'audit') };
  };

  it('audits the screen shown once it has settled, of every kind, with where each issue stands', async () => {
    const t = shown();
    await vi.advanceTimersByTimeAsync(200);
    expect(t.audit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.audit).toHaveBeenCalledTimes(1);
    expect(t.audit.mock.calls[0]?.[0]?.types).toBeUndefined();
    expect(t.audits().map((m) => m.state)).toEqual(['waiting', 'reading', 'done']);
    expect(t.audits().at(-1)).toMatchObject({
      issues: [
        {
          type: 'contrast',
          message: 'text contrast 2.1:1',
          label: 'Form',
          rect: { x: 0, y: 300 / 2400, w: 1, h: 100 / 2400 },
        },
        { type: 'hitRegion', message: 'touch target 30x30 dp' },
      ],
    });
    // the same screen is not audited again
    await vi.advanceTimersByTimeAsync(3_000);
    expect(t.audit).toHaveBeenCalledTimes(1);
  });

  it('audits a new screen, and the one shown again when a person asks', async () => {
    const t = shown();
    await vi.advanceTimersByTimeAsync(2_000);
    t.device.screen = 'form';
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.audit).toHaveBeenCalledTimes(2);
    t.flow.onWindow({ op: 'control', name: 'auditAgain' });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.audit).toHaveBeenCalledTimes(3);
  });

  it('audits nothing while a recording runs, and says so', async () => {
    const t = shown();
    await t.toggle();
    await vi.advanceTimersByTimeAsync(3_000);
    t.flow.onWindow({ op: 'control', name: 'auditAgain' });
    await vi.advanceTimersByTimeAsync(100);
    expect(t.audit).not.toHaveBeenCalled();
    expect(t.audits().at(-1)).toMatchObject({ state: 'recording', issues: [] });
    await t.toggle();
  });

  it('reads nothing once it hides', async () => {
    const t = shown();
    await vi.advanceTimersByTimeAsync(2_000);
    t.flow.onWindow({ op: 'paneWatch', pane: 'accessibility', on: false });
    await vi.advanceTimersByTimeAsync(500);
    const calls = t.device.calls.length;
    t.device.screen = 'form';
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.device.calls.length).toBe(calls);
    expect(t.audit).toHaveBeenCalledTimes(1);
  });
});
