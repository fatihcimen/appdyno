import { existsSync } from 'node:fs';
import {
  clientCalls,
  forgetClientCall,
  NEEDS,
  usbPhones,
  type Check,
  type DeviceProvider,
} from '@appdyno/core';
import {
  apply,
  BROWSER_CLIENTS,
  changedLines,
  changes,
  clientRows,
  CLIENTS,
  entryCommand,
  fileOf,
  outcomeFor,
  type Stdio,
} from '@appdyno/cli';
import { Adb, ownSwitches, PLATFORM_TOOLS } from '@appdyno/driver-android';
import { probeCommand, probeHttp, type Probe } from '@appdyno/mcp';
import { runKeys } from '@appdyno/perf';
import { ago, type HubPlaces } from '@appdyno/ops';
import { guideFor, listedPhones, runnerChecks } from './hub-connect.js';
import { HubHttp, httpToken, renewHttpToken } from './hub-http.js';
import { HubRuns } from './hub-run.js';

/** What an app opened from the Dock has: neither Homebrew nor a Node from a version manager. */
const DOCK_PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
/** The end of what a server said, which is where the reason is: all of it is for the client's own log. */
const TAIL_SHOWN = 300;

/** Each in English, as the hub's table has it, with what to do next: `words.test.ts` holds them to that table. */
export const TRIED = {
  listed: ['It started, and lists %@ tools.', 'Restart it, then ask it to list the devices.'],
  connected: ['It started, and lists %@ tools.', ''],
  missing: [
    'It could not find %@.',
    'An app opened from the Dock has a short PATH. Give its entry the full path of the command, and a PATH that holds node and adb, then restart it.',
  ],
  registry: [
    'appdyno is not on the npm registry yet.',
    'Run sh scripts/install.sh in a checkout, or use the Mac app, then add this client again.',
  ],
  slow: [
    'It gave no answer in 60 s.',
    "A first run downloads what it needs. Try again, then read the client's log and run Doctor in Help.",
  ],
  ended: ['It stopped before it answered.', 'Read what it said here, and run Doctor in Help.'],
  noServer: ['The server is not running.', 'Start it below, then test again.'],
  serves: [
    'The server answers on this Mac, and lists %@ tools.',
    'Now run a tunnel to it, and give the client the address.',
  ],
  held: [
    'Another client holds the server.',
    "It is free 10 minutes after that client's last call, or when the server stops.",
  ],
} as const;

type Tried = { ok: boolean; said: string; next: string; tail?: string };

/** What a try found, in a person's words. */
function triedWords(probe: Probe, o: { command?: string; connected: boolean }): Tried {
  if (probe.ok) {
    const [said, next] = o.command ? TRIED[o.connected ? 'connected' : 'listed'] : TRIED.serves;
    return { ok: true, said: said.replace('%@', String(probe.tools)), next };
  }
  if (probe.why === 'missing') {
    const [said, next] = TRIED.missing;
    return { ok: false, said: said.replace('%@', o.command ?? ''), next };
  }
  if (probe.why === 'ended' && /\b(E404|404)\b/.test(probe.tail ?? '')) {
    const [said, next] = TRIED.registry;
    return { ok: false, said, next };
  }
  const [said, next] = TRIED[probe.why];
  const tail = probe.tail?.slice(-TAIL_SHOWN);
  return { ok: false, said, next, ...(tail && { tail }) };
}

export type PlacesOptions = {
  /** Given, as `install` is: nothing but the caller can point this at a real home. */
  home: string;
  env: Record<string, string | undefined>;
  /** What a client runs, where it is not the npm package. */
  server?: Stdio;
  /** `appdyno mcp`, as this copy is run. */
  mcpCommand: string[];
  doctor(): Promise<Check[]>;
  /** This copy of appdyno, for what a person runs from the window. */
  self?: string[];
  /** Who to ask of phones; none, for what has no phones to speak of. */
  providers?: DeviceProvider[];
  /** Where kept runs are, for the apps they were made of. */
  measurements?: string;
};

type Message = Record<string, unknown>;
type Say = (said: Message) => void;
/** How a change is taken back: only the one entry, by the same edit, as a client may have written its file since. */
type Undo = { back?: Record<string, unknown> };

/** What the hub's AI Clients and Help ask of this Mac, from `install`'s own code. */
export function hubPlaces(o: PlacesOptions): HubPlaces {
  const where = { home: o.home, env: o.env, ...(o.server && { server: o.server }) };
  const http = new HubHttp(o.mcpCommand);
  const runs = new HubRuns(o.self ?? o.mcpCommand.slice(0, -1), o.env, o.home);
  /** What `doctor` found, kept: it is slow, and a tool comes or goes only by what a person ran. */
  let checks: Promise<Check[]> | undefined;
  const found = (fresh: boolean) => {
    if (fresh || !checks) checks = o.doctor().catch(() => []);
    return checks;
  };
  let looking = false;
  /** Only an app has a command to put on the PATH. */
  const fromApp = o.env.APPDYNO_HELPERS !== undefined;
  const undos = new Map<string, Undo>();
  const clientNamed = (m: Message) => CLIENTS.find((c) => c.name === m.client);
  const notes = [...CLIENTS, ...BROWSER_CLIENTS].flatMap((c) =>
    Object.entries(c.notes ?? {}).map(([kind, said]) => ({
      client: c.name,
      ...(c.tr && { clientTr: c.tr }),
      kind,
      ...said,
    })),
  );

  const status = () => ({
    rows: clientRows(where).map((r) => ({
      ...r,
      undo: undos.has(r.name),
      ...(r.last && { lastSaid: ago(r.last, Date.now()) }),
    })),
    browser: BROWSER_CLIENTS.map((c) => c.name),
    server: http.state,
    notes,
  });

  /** A person's word on a client, read fresh: a client may have written its file since the preview. */
  const planned = (m: Message, asked: Parameters<typeof outcomeFor>[2]) => {
    const client = clientNamed(m);
    const file = client && fileOf(client, where);
    return client && file ? outcomeFor(client, file, { ...where, ...asked }) : undefined;
  };

  const tryClient = async (m: Message): Promise<Tried> => {
    const name = String(m.client);
    if (BROWSER_CLIENTS.some((c) => c.name === name)) {
      if (!http.address) {
        const [said, next] = TRIED.noServer;
        return { ok: false, said, next };
      }
      return triedWords(await probeHttp(http.address, httpToken()), { connected: false });
    }
    const client = clientNamed(m);
    const entry = entryCommand(planned(m, {})?.had);
    if (!client || !entry) {
      const [said, next] = TRIED.missing;
      return { ok: false, said: said.replace('%@', name), next };
    }
    const env = {
      ...(o.env as Record<string, string>),
      ...(client.dock && { PATH: DOCK_PATH }),
      ...entry.env,
    };
    const row = clientRows(where).find((r) => r.name === name);
    return triedWords(await probeCommand({ ...entry, env, cwd: o.home }), {
      command: entry.command,
      connected: row?.state === 'connected',
    });
  };

  /** The phone in a person's hand, and how far along they are, as the Connect place shows it. */
  const look = async (fresh: boolean) => {
    const known = await found(fresh);
    const adb = new Adb();
    const phones = await listedPhones(o.providers ?? [], (serial) => ownSwitches(adb, serial));
    const has = (tool: string) => !known.some((c) => c.name === tool && !c.ok);
    const rows = clientRows(where);
    const guide = guideFor(o.providers ?? [], { usb: await usbPhones(), phones, has });
    return {
      ...guide,
      ...(guide.need && { needWords: NEEDS[guide.need] }),
      fromApp,
      terms: PLATFORM_TOOLS.terms,
      runner: runnerChecks(known),
      client: rows.some((r) => r.state === 'connected' || r.state === 'added'),
      prompt: clientCalls().length > 0,
    };
  };

  const acts: Record<string, (m: Message, say: Say) => Promise<unknown> | void> = {
    list: (_, say) => say(status()),
    connect: async (m, say) => {
      if (looking) return;
      looking = true;
      await look(m.fresh === true)
        .then((connect) => say({ connect }))
        .finally(() => {
          looking = false;
        });
    },
    run: (m, say) => {
      if (m.stop === true) return runs.stop(String(m.name));
      return runs.start(String(m.name), m as never, (said) => {
        // a tool that just came changes what a person is asked
        if (typeof (said.run as Message)?.code === 'number') checks = undefined;
        say(said);
      });
    },
    apps: async (_, say) => {
      const kept = o.measurements ? await runKeys(o.measurements).catch(() => []) : [];
      say({ apps: [...new Set(kept.map((k) => k.app))], fromApp });
    },
    preview: (m, say) => {
      const plan = planned(m, { remove: m.remove === true });
      if (!plan) return;
      say({
        preview: {
          client: plan.client.name,
          remove: m.remove === true,
          file: plan.file,
          did: plan.did,
          backup: existsSync(plan.file),
          lines: changedLines(plan.before, plan.after),
          ...(plan.why && { why: plan.why }),
        },
      });
    },
    change: (m, say) => {
      const plan = planned(m, { remove: m.remove === true });
      if (!plan || !changes(plan)) return say(status());
      const backup = apply(plan);
      undos.set(plan.client.name, plan.had === undefined ? {} : { back: plan.had as Undo['back'] });
      if (m.remove === true)
        for (const call of clientCalls())
          if (call.link === 'stdio' && plan.client.says.test(call.name)) forgetClientCall(call);
      say({
        ...status(),
        done: { client: plan.client.name, did: plan.did, file: plan.file, backup: backup ?? null },
      });
    },
    undo: (m, say) => {
      const undo = undos.get(String(m.client));
      if (!undo) return;
      const plan = planned(m, undo.back ? { back: undo.back } : { remove: true });
      if (plan && changes(plan)) apply(plan);
      undos.delete(String(m.client));
      say({ ...status(), done: { client: m.client, did: 'undone' } });
    },
    test: async (m, say) => say({ tested: { client: m.client, ...(await tryClient(m)) } }),
    start: async (_, say) => {
      await http.start().catch((e: Error) => say({ serverFailed: e.message }));
      say(status());
    },
    stop: async (_, say) => {
      await http.stop();
      say(status());
    },
    token: (_, say) => say({ token: httpToken() }),
    copyToken: (_, say) => say({ copy: httpToken(), concealed: true }),
    renewToken: async (_, say) => {
      const running = http.address !== undefined;
      await http.stop();
      renewHttpToken();
      if (running) await http.start().catch((e: Error) => say({ serverFailed: e.message }));
      say(status());
    },
    doctor: async (_, say) => say({ doctor: await o.doctor() }),
  };

  return {
    act: (m, say) => acts[String(m.do)]?.(m, say),
    end: () => Promise.all([http.stop(), runs.end()]).then(() => undefined),
  };
}
