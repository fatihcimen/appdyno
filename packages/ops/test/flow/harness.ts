import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type DeviceProvider } from '@appdyno/core';
import { expect } from 'vitest';
import { DEFAULT_POLICY, flowsFor as runnerOf, ServerContext, ToolError } from '../../src/index.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { callerOf as callsOf } from '@appdyno/testing/calls.js';
import { onFakeTime } from '@appdyno/testing/fake-time.js';

// a run's waits, a miss's and an app's end's, are the code's: the clock is faked, and runs on while a call is under way
export const callerOf = (ctx: ServerContext) => callsOf(ctx, onFakeTime);
export const flowsFor = (ctx: ServerContext) => {
  const flows = runnerOf(ctx);
  return {
    replay: (...a: Parameters<typeof flows.replay>) => onFakeTime(flows.replay(...a)),
    test: (...a: Parameters<typeof flows.test>) => onFakeTime(flows.test(...a)),
  };
};

export const SECRET = 's3cr3t-pass';

/** What the flow tests share, over the device and the folder each of its tests has. */
export function flowHelpers(deviceOf: () => FakeDevice, dirOf: () => string) {
  /** A server's, or with `env` a command line's; `app: null` selects none. */
  const context = (
    secrets: string[] = [],
    { app = 'dev.app', env }: { app?: string | null; env?: NodeJS.ProcessEnv } = {},
  ) => {
    const provider: DeviceProvider = {
      list: () => Promise.resolve([{ serial: deviceOf().serial, state: 'device', ready: true }]),
      handles: () => true,
      open: () => deviceOf(),
    };
    return new ServerContext({ ...DEFAULT_POLICY, secrets }, [provider], {
      app: app ?? undefined,
      ...(env && { env }),
    });
  };
  const refusal = async (p: Promise<unknown>) => {
    try {
      await p;
    } catch (e) {
      expect(e).toBeInstanceOf(ToolError);
      return e as ToolError;
    }
    throw new Error('it did not refuse');
  };
  const refOf = (text: string, label: string) =>
    new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(text)?.[1];

  const recorded = async (
    call: ReturnType<typeof callerOf>,
    actions: () => Promise<unknown>,
    name = 'a.flow',
  ) => {
    await call('flow', { action: 'start' });
    await actions();
    await call('flow', { action: 'stop' });
    const file = join(dirOf(), 'state', name);
    await call('flow', { action: 'save', file });
    return { file, text: readFileSync(file, 'utf8') };
  };

  return { context, refusal, refOf, recorded };
}
