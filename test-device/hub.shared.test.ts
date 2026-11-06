import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, describe, expect, it } from 'vitest';
import { viewerBinary, ViewerProcess, type ViewerMessage } from '../packages/core/src/index.js';
import {
  Adb,
  AndroidAgentLauncher,
  androidProvider,
} from '../packages/driver-android/src/index.js';
import {
  appleProvider,
  IosPhoneDevice,
  IosSimulatorDevice,
} from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { liveMirror } from '../packages/ops/src/mirror-state.js';
import { untilWithin } from './until.js';

/**
 * A person at the hub and an AI client on one device, as the product has them: the real `appdyno mcp` over stdio, in a
 * home of its own whose default state folder is the hub's. On the devices APPDYNO_HUB_DEVICES names (never a default),
 * with the fixture installed. APPDYNO_OTHER_AGENT and APPDYNO_OTHER_RUNNER name another build's agent and runner products,
 * for the client an update leaves beside a hub. APPDYNO_SHARED_LOG names a file for how it went.
 */
const serials = process.env.APPDYNO_HUB_DEVICES?.split(',') ?? [];
const APP = 'dev.appdyno.fixture';
const MAIN = join(import.meta.dirname, '../packages/appdyno/dist/main.js');
const log = process.env.APPDYNO_SHARED_LOG;
const until = untilWithin(60_000);
const LIVE_MS = 180_000;
const SCENE_MS = 420_000;

const { APPDYNO_OTHER_AGENT: agentBuild, APPDYNO_OTHER_RUNNER: runnerBuild } = process.env;
const OTHER_BUILD = {
  ...(agentBuild && { APPDYNO_ANDROID_AGENT: agentBuild }),
  ...(runnerBuild && {
    APPDYNO_IOS_PRODUCTS: runnerBuild,
    APPDYNO_IOS_DEVICE_PRODUCTS: runnerBuild,
  }),
};
const BUILDS = [
  { named: 'of this build', env: {} },
  ...(agentBuild || runnerBuild ? [{ named: 'of another build', env: OTHER_BUILD }] : []),
];

const isSimulator = (serial: string) => /^[0-9A-F]{8}-[0-9A-F]{4}-/i.test(serial);
const isIphone = (serial: string) => /^[0-9A-F]{8}-[0-9A-F]{16}$/i.test(serial);
const isAndroid = (serial: string) => !isSimulator(serial) && !isIphone(serial);
/** An iPhone's stream has its thread only from built files, and this runs from sources. */
const appleProviderFor = async (serial: string) =>
  isIphone(serial)
    ? (
        (await import(join(MAIN, '../../../driver-apple/dist/index.js'))) as {
          appleProvider: typeof appleProvider;
        }
      ).appleProvider()
    : appleProvider();
/** What this test left on a device: a home that goes leaves nothing to find it by. */
const stopAgent = async (serial: string) => {
  if (isSimulator(serial)) return new IosSimulatorDevice(serial).stopAgent();
  if (isIphone(serial)) return new IosPhoneDevice(serial).stopAgent();
  return new AndroidAgentLauncher(new Adb(), serial).stop();
};
/** The agent on the device, by its state file: a simulator has none until something needs it. */
const agentIn = (state: string, serial: string) => {
  const file = join(state, `${isAndroid(serial) ? 'android' : 'ios'}-${serial}.json`);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as { pid?: number }).pid : 0;
};

describe.runIf(serials.length > 0)('a hub and a client on one device', () => {
  const homes: string[] = [];
  afterAll(() => {
    for (const home of homes) rmSync(home, { recursive: true, force: true });
    delete process.env.APPDYNO_STATE_DIR;
  });

  const scene = (serial: string) => {
    const home = mkdtempSync(join(tmpdir(), 'appdyno-shared-'));
    homes.push(home);
    const state = join(home, 'Library/Caches/appdyno');
    mkdirSync(state, { recursive: true });
    process.env.APPDYNO_STATE_DIR = state;
    const heard: ViewerMessage[] = [];
    const said: string[] = [];
    const say = (line: string) => {
      said.push(line);
      if (log) appendFileSync(log, `${new Date().toISOString().slice(11, 23)} ${serial} ${line}\n`);
    };
    const clients: Client[] = [];
    let link: ViewerProcess | undefined;
    let listed = false;
    let done: Promise<number> | undefined;

    const openHub = async () => {
      const binary = await viewerBinary();
      const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^${serial}$`) };
      const ctx = new ServerContext(policy, [androidProvider(), await appleProviderFor(serial)]);
      done = runHub(ctx, {
        focus: false,
        behind: true,
        log: say,
        viewer: () => {
          link = new ViewerProcess(binary, ['--hub', '--behind', '--not-key']);
          link.onMessage((m) => heard.push(m));
          const send = link.send.bind(link);
          link.send = (m) => {
            listed ||= m.op === 'hub' && JSON.stringify(m).includes(`"${serial}"`);
            send(m);
          };
          return link;
        },
      });
      // a choice of a row the window has not been given is lost, and a phone's takes longer than a simulator's
      await until('its row', () => listed);
      link!.send({ op: 'poke', id: serial });
    };

    /** The real server over stdio, as a client starts it, and what calls it. */
    const openClient = async (env: Record<string, string> = {}) => {
      const { APPDYNO_STATE_DIR: _hubs, ...outer } = process.env as Record<string, string>;
      const client = new Client({ name: 'shared-test', version: '0' });
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            MAIN,
            'mcp',
            '--device',
            serial,
            '--app',
            APP,
            '--allow-devices',
            `^${serial}$`,
            '--allow-apps',
            APP,
          ],
          // an iPhone's runner is signed from this user's keychain, which a home of its own has not
          env: {
            ...outer,
            ...(isIphone(serial) ? { APPDYNO_STATE_DIR: state } : { HOME: home }),
            ...env,
          },
          stderr: 'ignore',
        }),
      );
      clients.push(client);
      return async (name: string, args: Record<string, unknown> = {}) => {
        const at = Date.now();
        // a runner's first start may take this long, and a client's own default of a minute is less
        const r = (await client.callTool({ name, arguments: args }, undefined, {
          timeout: LIVE_MS,
        })) as { isError?: boolean; content: { text?: string }[] };
        const text = r.content.map((c) => c.text ?? '').join('\n');
        const refused = r.isError === true;
        say(`${name}: ${Date.now() - at} ms, ${refused ? 'refused' : 'ok'}: ${text.slice(0, 90)}`);
        expect(refused, `${name}: ${text}`).toBe(false);
        return text;
      };
    };

    return {
      state,
      said,
      openClient,
      openHub,
      live: () =>
        until(
          'the device live',
          () => heard.some((m) => m.op === 'first' && m.stage === serial),
          LIVE_MS,
        ),
      /** A client's whole round: a touch, a picture, the numbers and a measure, and it sees the window. */
      drive: async (call: Awaited<ReturnType<typeof openClient>>) => {
        await call('launch_app', { read: 'full' });
        await call('tap', { x: 200, y: 400, read: 'none' });
        await call('screenshot');
        await call('perf_snapshot');
        await call('perf_launch', { repeats: 1 });
        expect(await call('mirror', { action: 'status' })).toContain('live');
      },
      /** A person's click on the picture, which has to reach the device with the client driving. */
      touched: async () => {
        link!.send({ op: 'poke', stage: serial, x: 0.5, y: 0.75 });
        await until('the touch', () => liveMirror(serial)?.status.touchedAt !== undefined);
        expect(liveMirror(serial)?.status).toMatchObject({ state: 'live', inputFailed: 0 });
      },
      end: async () => {
        await Promise.all(clients.map((c) => c.close()));
        link?.send({ op: 'quit' });
        await done;
        await stopAgent(serial);
      },
    };
  };

  for (const serial of serials) {
    for (const { named, env } of BUILDS) {
      it(
        `takes a client ${named} on ${serial} with the hub open`,
        async () => {
          const s = scene(serial);
          try {
            await s.openHub();
            await s.live();
            const agent = agentIn(s.state, serial);
            await s.drive(await s.openClient(env));
            await s.touched();
            // a simulator's window needs no runner: the client's is the first
            if (agent) expect(agentIn(s.state, serial)).toBe(agent);
          } finally {
            await s.end();
          }
        },
        SCENE_MS,
      );

      it(
        `opens the hub on ${serial} beside a client ${named}`,
        async () => {
          const s = scene(serial);
          try {
            const call = await s.openClient(env);
            await call('launch_app', { read: 'full' });
            const agent = agentIn(s.state, serial);
            await s.openHub();
            await s.live();
            expect(agentIn(s.state, serial)).toBe(agent);
            await s.drive(call);
            await s.touched();
            // a cold start ends a runner by itself, with no hub about
            if (isAndroid(serial)) expect(agentIn(s.state, serial)).toBe(agent);
          } finally {
            await s.end();
          }
        },
        SCENE_MS,
      );
    }

    it.runIf(BUILDS.length > 1)(
      `keeps two clients of two builds on ${serial} from replacing each other's agent`,
      async () => {
        const s = scene(serial);
        try {
          const first = await s.openClient();
          await first('launch_app', { read: 'full' });
          const agent = agentIn(s.state, serial);
          const second = await s.openClient({ ...OTHER_BUILD, APPDYNO_SHARE: '1' });
          await second('launch_app', { read: 'full' });
          await first('tap', { x: 200, y: 400, read: 'none' });
          await second('tap', { x: 200, y: 400, read: 'none' });
          expect(agentIn(s.state, serial)).toBe(agent);
        } finally {
          await s.end();
        }
      },
      SCENE_MS,
    );

    it.runIf(isAndroid(serial))(
      `leaves ${serial} to a client of a state folder of its own`,
      async () => {
        const s = scene(serial);
        const own = join(s.state, '..', 'a-test-run');
        try {
          const call = await s.openClient({ APPDYNO_STATE_DIR: own });
          await call('launch_app', { read: 'full' });
          const agent = agentIn(own, serial);
          await s.openHub();
          await until('the hub to say so', () =>
            s.said.some((l) => l.includes('state folder of its own')),
          );
          await call('tap', { x: 200, y: 400, read: 'none' });
          expect(agentIn(own, serial)).toBe(agent);
        } finally {
          await s.end();
          process.env.APPDYNO_STATE_DIR = own;
          await stopAgent(serial);
        }
      },
      SCENE_MS,
    );
  }
});
