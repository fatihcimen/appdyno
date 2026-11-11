import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { must } from '@appdyno/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { claim, PUT_BACK_TOOL } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-driving-')));
});

describe('device claims', () => {
  const claimOf = (pid: number, tool = 'other agent') => {
    const started = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], {
      encoding: 'utf8',
    }).trim();
    const dir = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid, started, tool, since: '2026-11-03T00:00:00Z' }),
    );
  };

  it('refuses a device a live process holds, naming it, unless asked to share', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(child.pid, "the child's pid");
    try {
      claimOf(pid);
      const d = new FakeDevice();
      const { call, ctx } = await connect(d, { defaults: { claims: { share: false } } });
      const r = await call('use_device', { device: d.serial });
      expect(r.error).toBe(true);
      expect(r.data.code).toBe('DEVICE_CLAIMED');
      expect(r.text).toContain(`pid ${pid}`);
      expect(r.text).toContain('other agent');
      expect((await call('list_devices')).data.devices?.[0]?.heldBy?.pid).toBe(pid);
      expect((await call('use_device', { device: d.serial, share: true })).error).toBe(false);
      ctx.close();
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('waits out the hold of what puts back a server that has gone, and then takes the device', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    claimOf(must(child.pid, "the child's pid"), PUT_BACK_TOOL);
    let done: NodeJS.Timeout | undefined;
    try {
      const d = new FakeDevice();
      const { call, ctx } = await connect(d, { defaults: { claims: { share: false } } });
      const started = Date.now();
      done = setTimeout(() => child.kill('SIGKILL'), 500);
      expect((await call('use_device', { device: d.serial })).error).toBe(false);
      expect(Date.now() - started).toBeGreaterThanOrEqual(400);
      ctx.close();
    } finally {
      clearTimeout(done);
      child.kill('SIGKILL');
    }
  });

  it('refuses that hold too once it outlasts the wait', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    const pid = must(child.pid, "the child's pid");
    try {
      claimOf(pid, PUT_BACK_TOOL);
      await expect(claim('emulator-5580', 'appdyno mcp', 300)).rejects.toMatchObject({
        code: 'DEVICE_CLAIMED',
        message: expect.stringContaining(`pid ${pid} (${PUT_BACK_TOOL})`) as unknown,
      });
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('frees a dead owner’s claim, a pid reused by another process, and its own at the end', async () => {
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
    claimOf(must(child.pid, "the child's pid"));
    child.kill('SIGKILL');
    await new Promise((r) => child.once('exit', r));
    const d = new FakeDevice();
    const first = await connect(d, { defaults: { claims: { share: false }, tool: 'one' } });
    expect((await first.call('use_device', { device: d.serial })).error).toBe(false);
    expect((await first.call('list_devices')).data.devices?.[0]?.heldBy).toMatchObject({
      pid: process.pid,
      tool: 'one',
    });
    first.ctx.close();
    expect(
      must((await first.call('list_devices')).data.devices?.[0], 'the device').heldBy,
    ).toBeUndefined();
    const dir = join(must(process.env.APPDYNO_STATE_DIR, 'APPDYNO_STATE_DIR'), 'claims');
    writeFileSync(
      join(dir, 'emulator-5580.json'),
      JSON.stringify({ pid: process.pid, started: 'long ago', tool: 'x', since: 'y' }),
    );
    const second = await connect(new FakeDevice(), { defaults: { claims: { share: false } } });
    expect(
      must((await second.call('list_devices')).data.devices?.[0], 'the device').heldBy,
    ).toBeUndefined();
  });
});
