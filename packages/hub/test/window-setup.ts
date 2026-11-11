import { readFileSync } from 'node:fs';
import { must, type DeviceProvider, type InputEvent } from '@appdyno/core';
import { keyOfUsage } from '@appdyno/protocol';
import { vi } from 'vitest';
import { windowFlow } from '../src/flow.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { DEFAULT_POLICY, ServerContext } from '@appdyno/ops';

export const PASSWORD = 's3cr3t-pass';

let serial = 6000;
/** A device's serial no other of its file had: each file starts where no other file's are, as their state is one. */
export const nextSerial = () => `emulator-${serial++}`;
export const serialsFrom = (first: number) => {
  serial = first;
};

export function setup(device: FakeDevice = new FakeDevice(nextSerial())) {
  device.apps = {
    listApps: () => Promise.resolve([{ id: 'dev.app' }]),
  } as unknown as FakeDevice['apps'];
  device.mirror = { keyOf: keyOfUsage } as unknown as FakeDevice['mirror'];
  const told: Record<string, unknown>[] = [];
  const status = { state: 'live' };
  const window = { tell: (m: Record<string, unknown>) => told.push(m), status };
  let measuring = false;
  const provider: DeviceProvider = {
    list: () => Promise.resolve([{ serial: device.serial, state: 'device', ready: true }]),
    handles: () => true,
    open: () => device,
  };
  const ctx = new ServerContext(DEFAULT_POLICY, [provider], {
    device: device.serial,
    app: 'dev.app',
  });
  const flow = windowFlow(
    ctx,
    device,
    { platform: 'android', controls: [], model: 'Test Phone' },
    () => window as never,
    () => measuring,
  );

  const settle = () => vi.advanceTimersByTimeAsync(400);
  const touch = (p: 0 | 1 | 2, x: number, y: number, more: Partial<InputEvent> = {}) =>
    flow.input({ kind: 'touch', p, x: x / 1080, y: y / 2400, ...more } as InputEvent);
  /** A click as a device takes it: what it does comes after the finger lifts. */
  const click = async (x: number, y: number, heldMs = 80) => {
    touch(0, x, y);
    await vi.advanceTimersByTimeAsync(heldMs);
    touch(2, x, y);
    await device.act({ kind: 'tap', x, y });
    await settle();
  };
  const drag = async (x: number, y: number, x2: number, y2: number) => {
    touch(0, x, y);
    await vi.advanceTimersByTimeAsync(50);
    touch(1, x2, y2);
    await vi.advanceTimersByTimeAsync(50);
    touch(2, x2, y2);
    await settle();
  };
  const type = async (text: string) => {
    for (const s of text) flow.input({ kind: 'text', s });
    await settle();
  };
  const key = (usage: number) => flow.input({ kind: 'key', page: 7, usage, state: 1 });
  const press = async (name: string) => {
    flow.input({ kind: 'button', name });
    await settle();
  };
  const toggle = async () => {
    flow.onWindow({ op: 'control', name: 'recordFlow' });
    await settle();
  };
  const notes = () => told.filter((m) => m.op === 'note').map((m) => String(m.text));
  const said = () => told.filter((m) => m.op === 'flow').at(-1) as { lines: string[] };
  const lines = () => said().lines;
  const saved = () => {
    const file = must(
      (told.filter((m) => m.op === 'flow').at(-1) as { file?: string }).file,
      'the saved flow',
    );
    return { file, text: readFileSync(file, 'utf8') };
  };
  return {
    device,
    ctx,
    flow,
    told,
    status,
    measure: (on: boolean) => (measuring = on),
    settle,
    touch,
    click,
    drag,
    type,
    key,
    press,
    toggle,
    notes,
    lines,
    saved,
  };
}

export const FORM_BUTTON = { x: 540, y: 350 };

export const SEND = { x: 540, y: 550 };
