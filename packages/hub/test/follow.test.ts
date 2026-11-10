import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendActivity } from '@appdyno/ops';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { followDevice } from '../src/follow.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-follow-'));
const before = process.env.APPDYNO_STATE_DIR;
const activityFile = () => join(dir, 'activity/guarded.jsonl');

beforeAll(() => {
  process.env.APPDYNO_STATE_DIR = dir;
});

afterAll(() => {
  if (before === undefined) delete process.env.APPDYNO_STATE_DIR;
  else process.env.APPDYNO_STATE_DIR = before;
  rmSync(dir, { recursive: true, force: true });
});

describe('what a window is told', () => {
  it('names the client that drives, as a person knows it', async () => {
    vi.useFakeTimers();
    try {
      rmSync(activityFile(), { force: true });
      const seen: Record<string, unknown>[] = [];
      const off = followDevice('guarded', { tell: (m) => seen.push(m) });
      appendActivity('guarded', {
        at: Date.now(),
        tool: 'tap',
        ms: 3,
        ok: true,
        args: {},
        client: 'said by name',
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(seen[0]).toEqual({ op: 'agent', driving: true, tool: 'tap', client: 'said by name' });
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks that an agent is driving while calls come, and for 2 s after', async () => {
    vi.useFakeTimers();
    try {
      rmSync(activityFile(), { force: true });
      const told: Record<string, unknown>[] = [];
      const off = followDevice('guarded', { tell: (m) => told.push(m) });
      await vi.advanceTimersByTimeAsync(500);
      expect(told).toEqual([]);
      appendActivity('guarded', { at: Date.now(), tool: 'tap', ms: 3, ok: true, args: {} });
      await vi.advanceTimersByTimeAsync(300);
      expect(told[0]).toEqual({ op: 'agent', driving: true, tool: 'tap' });
      expect(told[1]).toMatchObject({ op: 'activity', tool: 'tap', ms: 3, ok: true, args: '{}' });
      await vi.advanceTimersByTimeAsync(1_500);
      expect(told.filter((m) => m.driving === false)).toEqual([]);
      await vi.advanceTimersByTimeAsync(600);
      expect(told.at(-1)).toEqual({ op: 'agent', driving: false });
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands on each call an agent made, for what the window lists to follow it', async () => {
    vi.useFakeTimers();
    try {
      rmSync(activityFile(), { force: true });
      const heard: unknown[] = [];
      const off = followDevice('guarded', { tell: () => undefined }, undefined, (l) =>
        heard.push(l.args),
      );
      appendActivity('guarded', {
        at: Date.now(),
        tool: 'app',
        ms: 3,
        ok: true,
        args: { action: 'install' },
      });
      await vi.advanceTimersByTimeAsync(300);
      expect(heard).toEqual([{ action: 'install' }]);
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts up a request for a person once, and takes it down when it ends', async () => {
    vi.useFakeTimers();
    try {
      const file = join(dir, 'handoff/guarded.json');
      rmSync(file, { force: true });
      const told: Record<string, unknown>[] = [];
      const off = followDevice('guarded', { tell: (m) => told.push(m) });
      mkdirSync(join(dir, 'handoff'), { recursive: true });
      writeFileSync(file, JSON.stringify({ id: 'r1', reason: 'Face ID' }));
      await vi.advanceTimersByTimeAsync(600);
      expect(told.filter((m) => m.op === 'banner')).toEqual([
        { op: 'banner', id: 'r1', text: 'Face ID', needsDone: true, sound: true },
      ]);
      rmSync(file);
      await vi.advanceTimersByTimeAsync(300);
      expect(told.at(-1)).toEqual({ op: 'banner' });
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts up the request of a server run --silent with no sound', async () => {
    vi.useFakeTimers();
    try {
      const file = join(dir, 'handoff/guarded.json');
      const told: Record<string, unknown>[] = [];
      const off = followDevice('guarded', { tell: (m) => told.push(m) });
      mkdirSync(join(dir, 'handoff'), { recursive: true });
      writeFileSync(file, JSON.stringify({ id: 'r2', reason: 'Face ID', silent: true }));
      await vi.advanceTimersByTimeAsync(600);
      expect(told.filter((m) => m.op === 'banner')).toEqual([
        { op: 'banner', id: 'r2', text: 'Face ID', needsDone: true, sound: false },
      ]);
      rmSync(file);
      off();
    } finally {
      vi.useRealTimers();
    }
  });
});
