import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  run,
  stateDir,
  type NetworkAnswer,
  type NetworkControl,
  type NetworkDetail,
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
        sees: "the URLSession requests of the app, restarted with the probe: method, URL, status, time, size; headers and text bodies with bodies; with mock its rules answer, fail, delay or send elsewhere what they take, and throttle slows them. Not background sessions, WKWebView or Network.framework. While it is in, the app's own check of a server's certificate (pinning) and its answers to a login or client-certificate challenge are not asked: a server the app would refuse is let through, and one that asks the app for a certificate fails",
      },
      { via: 'packets', refused: 'a simulator has no packet trace of its own' },
      { via: 'bytes', refused: "a simulator's traffic is the Mac's: no count per app" },
    ]);
  }

  async start(via: NetworkVia, app: string | undefined, bodies = false): Promise<NetworkHandle> {
    if (via !== 'probe')
      throw new DeviceError(
        'UNSUPPORTED',
        `${via} is not a way of a simulator: use probe or proxy`,
      );
    if (!app) throw new DeviceError('INVALID_ARGUMENT', 'the probe goes into one app: give app');
    // the capture's own folder: its log, what the probe is told, and the bodies it keeps, all gone with it
    const dir = join(stateDir(), 'network', randomBytes(4).toString('hex'));
    mkdirSync(join(dir, 'bodies'), { recursive: true, mode: 0o700 });
    const handle = { via, log: join(dir, 'log.jsonl'), dir, app };
    this.control(handle, { bodies, rules: [] });
    const lib = await helperBinary('NetProbe');
    this.holds.hold(assertBundle(app), PROBE, { lib, env: { APPDYNO_NET_DIR: dir } });
    await this.simctl.restart(this.udid, app).catch((e: unknown) => {
      this.holds.drop(app, PROBE);
      rmSync(dir, { recursive: true, force: true });
      throw e;
    });
    return handle;
  }

  /** Written beside and then moved into place: the probe reads it whole or not at all. */
  control(h: NetworkHandle, control: NetworkControl) {
    const file = join(String(h.dir), 'control.json');
    writeFileSync(`${file}.new`, JSON.stringify(control), { mode: 0o600 });
    renameSync(`${file}.new`, file);
  }

  async detail(h: NetworkHandle, id: number): Promise<NetworkDetail | undefined> {
    const name = probeEntries(await readFile(String(h.log), 'utf8').catch(() => '')).find(
      (e) => e.id === id,
    )?.detail;
    // a name of the probe's own making, and nothing that leaves the folder
    if (!name || !/^[\d-]+$/.test(name)) return undefined;
    const text = await readFile(join(String(h.dir), 'bodies', `${name}.json`), 'utf8').catch(
      () => undefined,
    );
    return text === undefined ? undefined : (JSON.parse(text) as NetworkDetail);
  }

  async read(h: NetworkHandle, bare = false): Promise<NetworkAnswer> {
    const text = await readFile(String(h.log), 'utf8').catch(() => '');
    const entries = probeEntries(text);
    if (bare) return { entries };
    const notes = [
      ...(!entries.some((e) => !e.inFlight)
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
    // with its folder gone the probe in a running app does nothing more: no rule, no delay, no file
    if (h.dir) rmSync(String(h.dir), { recursive: true, force: true });
    else rmSync(String(h.log), { force: true });
    if (h.app) this.holds.drop(String(h.app), PROBE);
    return {
      ...answer,
      note: 'the probe stays in the app until it next starts, and does nothing more there',
    };
  }
}

type Probed = NetworkEntry & { detail?: string };
type Line = Probed & { at: number; loaded?: string; begin?: number; n?: number };

/**
 * The requests of the probe's log, each numbered as it starts: a request has a line when it starts and one when it
 * ends, by its number in its process, and one with no end yet is in flight. A line for a process the probe went into
 * is no request: what the process before it left under way ended with it.
 */
export function probeEntries(text: string, now = Date.now()): Probed[] {
  const out: Probed[] = [];
  let open = new Map<number, Probed>();
  for (const l of text.split('\n')) {
    let e: Line;
    try {
      e = JSON.parse(l) as Line;
    } catch {
      // empty, or the last line half written
      continue;
    }
    if (e.loaded !== undefined) {
      for (const left of open.values())
        Object.assign(left, { inFlight: undefined, error: 'the app ended before it did' });
      open = new Map();
    } else if (e.begin !== undefined) {
      const { begin, ...start } = e;
      const entry: Probed = {
        ...start,
        id: out.length,
        at: new Date(e.at).toISOString(),
        ms: Math.max(0, Math.round(now - e.at)),
        inFlight: true,
      };
      out.push(entry);
      open.set(begin, entry);
    } else {
      const { n, ...end } = e;
      const done = { ...end, at: new Date(e.at).toISOString(), ms: Math.round(e.ms ?? 0) };
      const begun = n === undefined ? undefined : open.get(n);
      if (begun && n !== undefined) {
        open.delete(n);
        Object.assign(begun, done, { inFlight: undefined });
      } else out.push({ ...done, id: out.length });
    }
  }
  return out.map(({ inFlight, ...e }) => (inFlight ? { ...e, inFlight } : e));
}
