import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  run,
  stateDir,
  type NetworkAnswer,
  type NetworkEntry,
  type NetworkHandle,
  type NetworkPath,
  type NetworkSource,
  type NetworkVia,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { probeHead } from './probe.js';
import { HeldLaunches, NETWORK_PROBE } from './sim-held.js';
import { helperBinary } from './simhelper.js';
import { assertBundle, type Simctl } from './simctl.js';

/** The network probe's name among what an app's launches carry. */
const PROBE = NETWORK_PROBE;

/** The Mac's HTTP proxy as `host:port`, or `none`: what a simulator's apps go through. */
export async function macProxy(): Promise<string> {
  const { stdout } = await run('scutil', ['--proxy']);
  const word = (k: string) => new RegExp(`\\b${k} : (\\S+)`).exec(stdout)?.[1];
  return word('HTTPEnable') === '1'
    ? `${String(word('HTTPProxy'))}:${String(word('HTTPPort'))}`
    : 'none';
}

/**
 * An app on a simulator with the probe in it (`ios/SimHelper/NetProbe.m`), which logs to a file here; held in each launch
 * this tool makes of it while the capture runs.
 */
export class SimulatorNetwork implements NetworkSource {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
    private readonly holds = new HeldLaunches(udid),
  ) {}

  paths(): Promise<NetworkPath[]> {
    return Promise.resolve([
      {
        via: 'probe',
        sees: 'the URLSession requests of the app, restarted with the probe: method, URL, status, time, size. Not background sessions, WKWebView or Network.framework. No bodies',
      },
      { via: 'packets', refused: 'a simulator has no packet trace of its own' },
      { via: 'bytes', refused: "a simulator's traffic is the Mac's: no count per app" },
    ]);
  }

  async start(via: NetworkVia, app: string | undefined): Promise<NetworkHandle> {
    if (via !== 'probe')
      throw new DeviceError(
        'UNSUPPORTED',
        `${via} is not a way of a simulator: use probe or proxy`,
      );
    if (!app) throw new DeviceError('INVALID_ARGUMENT', 'the probe goes into one app: give app');
    const dir = join(stateDir(), 'network');
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const log = join(dir, `${randomBytes(4).toString('hex')}.jsonl`);
    const lib = await helperBinary('NetProbe');
    this.holds.hold(assertBundle(app), PROBE, { lib, env: { APPDYNO_NET_LOG: log } });
    await this.simctl.restart(this.udid, app).catch((e: unknown) => {
      this.holds.drop(app, PROBE);
      throw e;
    });
    return { via, log, app };
  }

  async read(h: NetworkHandle): Promise<NetworkAnswer> {
    const text = await readFile(String(h.log), 'utf8').catch(() => '');
    const entries = probeEntries(text);
    const notes = [
      ...(entries.length === 0
        ? ['no request has finished in the app since the probe went in']
        : []),
      ...(h.app ? [await this.outside(String(h.app), text)] : []),
    ].filter(Boolean);
    return { entries, ...(notes.length > 0 && { note: notes.join('; ') }) };
  }

  /** What a read says where the app runs as another process than the one the probe last went into. */
  private async outside(app: string, text: string) {
    const probed = probeHead(text).pid;
    const pid = await this.simctl.pid(this.udid, app).catch(() => undefined);
    return probed !== undefined && pid !== undefined && pid !== probed
      ? `${app} runs as a process the probe is not in: its requests since are not seen`
      : undefined;
  }

  async stop(h: NetworkHandle): Promise<NetworkAnswer> {
    const answer = await this.read(h);
    rmSync(String(h.log), { force: true });
    if (h.app) this.holds.drop(String(h.app), PROBE);
    return { ...answer, note: 'the probe stays in the app until it next starts' };
  }
}

/** The requests of the probe's log; a line for a process the probe went into is none. */
const probeEntries = (text: string): NetworkEntry[] =>
  text
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      const e = JSON.parse(l) as { at: number; loaded?: string } & NetworkEntry;
      if (e.loaded !== undefined) return [];
      return [{ ...e, at: new Date(e.at).toISOString(), ms: Math.round(e.ms ?? 0) }];
    });
