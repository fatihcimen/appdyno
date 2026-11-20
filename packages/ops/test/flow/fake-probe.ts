import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  NetworkControl,
  NetworkDetail,
  NetworkEntry,
  NetworkHandle,
  NetworkSource,
} from '@appdyno/core';
import { afterEach, beforeEach, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { flowHelpers } from './harness.js';

/** A probe that keeps what it is told and gives what the test put in it. */
export class FakeProbe implements NetworkSource {
  entries: NetworkEntry[] = [];
  details: Record<number, NetworkDetail> = {};
  controls: NetworkControl[] = [];
  started: { app: string | undefined; bodies: boolean | undefined }[] = [];
  stopped = 0;
  paths = () => Promise.resolve([{ via: 'probe' as const, sees: 'requests' }]);
  start = (_: string, app: string | undefined, bodies?: boolean): Promise<NetworkHandle> => {
    this.started.push({ app, bodies });
    return Promise.resolve({ via: 'probe', app: app ?? '' });
  };
  read = () => Promise.resolve({ entries: this.entries.map((e, id) => ({ ...e, id })) });
  stop = async () => {
    this.stopped++;
    return { ...(await this.read()), note: 'ended' };
  };
  control = (_: NetworkHandle, control: NetworkControl) => void this.controls.push(control);
  detail = (_: NetworkHandle, id: number) => Promise.resolve(this.details[id]);
  get told() {
    return this.controls.at(-1);
  }
}

/**
 * A fake device with a fake probe for each test of a suite, in a folder of its own that the server runs in, on a faked
 * clock: read from what this returns once a test runs.
 */
export function probeSetup() {
  const at = { dir: '', device: new FakeDevice(), probe: new FakeProbe() };
  let stopped = 0;
  const helpers = flowHelpers(
    () => at.device,
    () => at.dir,
  );
  /** A flow's file in the suite's folder, for the app the context selects. */
  const flowFile = (body: string) => {
    mkdirSync(join(at.dir, 'flows'), { recursive: true });
    const file = join(at.dir, 'flows', 'a.flow');
    writeFileSync(file, `app dev.app\n${body}\n`);
    return file;
  };
  beforeEach(() => {
    at.dir = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-probe-')));
    vi.stubEnv('APPDYNO_STATE_DIR', join(at.dir, 'state'));
    vi.spyOn(process, 'cwd').mockReturnValue(at.dir);
    at.device = new FakeDevice();
    at.probe = new FakeProbe();
    Object.assign(at.device, { network: at.probe });
    // never before where the last test's clock stopped: an action tells a capture from the one before by when it began,
    // and a test whose clock ran on past this Mac's had its capture begin at the very moment the next one's did
    vi.useFakeTimers({ now: Math.max(Date.now(), stopped + 1) });
  });
  afterEach(() => {
    stopped = Date.now();
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  return Object.assign(at, { helpers, flowFile });
}
