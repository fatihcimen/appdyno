import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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
import { helperBinary } from './simhelper.js';
import { assertBundle, type Simctl } from './simctl.js';

/** The Mac's HTTP proxy as `host:port`, or `none`: what a simulator's apps go through. */
export async function macProxy(): Promise<string> {
  const { stdout } = await run('scutil', ['--proxy']);
  const word = (k: string) => new RegExp(`\\b${k} : (\\S+)`).exec(stdout)?.[1];
  return word('HTTPEnable') === '1' ? `${word('HTTPProxy')}:${word('HTTPPort')}` : 'none';
}

/** An app on a simulator with the probe in it (`ios/SimHelper/NetProbe.m`), which logs to a file here. */
export class SimulatorNetwork implements NetworkSource {
  constructor(
    private readonly simctl: Simctl,
    private readonly udid: string,
  ) {}

  async paths(): Promise<NetworkPath[]> {
    return [
      {
        via: 'probe',
        sees: 'the URLSession requests of the app, restarted with the probe: method, URL, status, time, size. Not background sessions, WKWebView or Network.framework. No bodies',
      },
      { via: 'packets', refused: 'a simulator has no packet trace of its own' },
      { via: 'bytes', refused: "a simulator's traffic is the Mac's: no count per app" },
    ];
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
    await this.simctl.exec(
      ['launch', '--terminate-running-process', this.udid, assertBundle(app)],
      60_000,
      {
        SIMCTL_CHILD_DYLD_INSERT_LIBRARIES: await helperBinary('NetProbe'),
        SIMCTL_CHILD_APPDYNO_NET_LOG: log,
      },
    );
    return { via, log };
  }

  async read(h: NetworkHandle): Promise<NetworkAnswer> {
    const log = String(h.log);
    if (!existsSync(log))
      return {
        entries: [],
        note: 'no request has finished in the app since the probe went in',
      };
    const entries = readFileSync(log, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        const e = JSON.parse(l) as { at: number; error?: string } & NetworkEntry;
        return {
          ...e,
          at: new Date(e.at).toISOString(),
          ms: Math.round(e.ms ?? 0),
        };
      });
    return { entries };
  }

  async stop(h: NetworkHandle): Promise<NetworkAnswer> {
    const answer = await this.read(h);
    rmSync(String(h.log), { force: true });
    return { ...answer, note: 'the probe stays in the app until it next starts' };
  }
}
