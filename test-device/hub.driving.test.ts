import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hubServices } from '../packages/appdyno/src/hub-services.js';
import { clientNamed, CLIENTS } from '../packages/cli/src/index.js';
import { viewerBinary, ViewerProcess, type ViewerMessage } from '../packages/core/src/index.js';
import { appleProvider } from '../packages/driver-apple/src/index.js';
import { DEFAULT_POLICY, ServerContext } from '../packages/ops/src/index.js';
import { runHub } from '../packages/hub/src/index.js';
import { untilWithin } from './until.js';

/**
 * A real MCP client through a real server, on a simulator we hold (APPDYNO_HUB_SIMULATOR; never a default), in the hub's real
 * window kept off every screen: its name on the device it drives, and the one real call that earns it Connected. Its home
 * is a folder of its own, and the fixture is installed there. APPDYNO_SHOTS names a folder for pictures.
 */
const serial = process.env.APPDYNO_HUB_SIMULATOR;
const dist = join(import.meta.dirname, '../packages/appdyno/dist');
const shots = process.env.APPDYNO_SHOTS;
const look = process.env.APPDYNO_HUB_LOOK ?? 'dark';
const language = process.env.APPDYNO_HUB_LANGUAGE ?? 'en';
const tag = `${look}-${language}`;
const client = CLIENTS.find((c) => c.ownFile)!;
/** As it names itself. */
const said = client.says.source;

describe.runIf(serial)('a client driving a device in the hub', () => {
  const heard: ViewerMessage[] = [];
  const sent: Record<string, unknown>[] = [];
  let home: string;
  let link: ViewerProcess;
  let done: Promise<number>;
  let agent: Client;
  let front: string;
  let model: string;

  const quiet = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = untilWithin(60_000);
  const clickRow = async (title: string) => {
    heard.length = 0;
    link.send({ op: 'poke', clickRow: title });
    await until(`row ${title}`, () => heard.some((m) => m.op === 'clicked'));
    expect(heard.find((m) => m.op === 'clicked')).toMatchObject({ found: true });
  };
  const looked = async (name: string) => {
    await quiet(400);
    const file = join(shots ?? home, `${name}-${tag}.png`);
    heard.length = 0;
    link.send({ op: 'snapshot', file });
    await until('picture', () => heard.some((m) => m.op === 'snapped'));
    const { parts } = heard.find((m) => m.op === 'snapped') as unknown as {
      parts: { text: string }[];
    };
    if (shots) writeFileSync(file.replace('.png', '.json'), JSON.stringify(parts));
    return parts.map((p) => p.text).join('|');
  };

  beforeAll(async () => {
    home = mkdtempSync(join(tmpdir(), 'appdyno-hub-driving-'));
    process.env.APPDYNO_STATE_DIR = join(home, 'state');
    const file = join(home, client.files[0]!);
    mkdirSync(dirname(file), { recursive: true });
    const entry = { command: process.execPath, args: [join(dist, 'main.js'), 'mcp'] };
    writeFileSync(file, JSON.stringify({ [client.key]: { appdyno: entry } }));
    // before the window: what is in front is read as a stream opens
    execFileSync('xcrun', ['simctl', 'launch', serial!, 'dev.appdyno.fixture']);
    const binary = await viewerBinary();
    const policy = { ...DEFAULT_POLICY, devices: new RegExp(`^${serial}$`) };
    const ctx = new ServerContext(policy, [appleProvider()], { clientNamed });
    done = runHub(ctx, {
      focus: false,
      behind: true,
      log: () => undefined,
      services: hubServices({
        home,
        env: { ...process.env, HOME: home },
        mcpCommand: [process.execPath, join(dist, 'main.js'), 'mcp'],
        doctor: async () => [],
      }),
      viewer: () => {
        link = new ViewerProcess(binary, [
          '--hub',
          '--behind',
          '--appearance',
          look,
          '--not-key',
          ...(language === 'tr' ? ['-AppleLanguages', '(tr)'] : []),
        ]);
        link.onMessage((m) => heard.push(m));
        const send = link.send.bind(link);
        link.send = (m) => {
          sent.push(m);
          send(m);
        };
        return link;
      },
    });
    await until('the device live', () => heard.some((m) => m.op === 'first' && m.stage === serial));
    await until(
      'the app in front named',
      () => sent.some((m) => m.op === 'results' && m.app),
      170_000,
    );
    front = String(sent.find((m) => m.op === 'results' && m.app)!.app);
    const { devices } = sent.find((m) => m.devices) as { devices: { model: string }[] };
    model = devices[0]!.model;
  }, 300_000);

  afterAll(async () => {
    await agent?.close();
    link?.send({ op: 'quit' });
    await done;
    rmSync(home, { recursive: true, force: true });
  }, 60_000);

  it('is named on the device it drives, in the capsule, as a person knows it', async () => {
    agent = new Client({ name: said, version: '1' });
    await agent.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(dist, 'mcp-bin.js'), '--device', serial!, '--allow-devices', `^${serial}$`],
        env: process.env as Record<string, string>,
      }),
    );
    const driving = (async () => {
      for (let i = 0; i < 12; i++) {
        await agent.callTool({ name: 'device_info' });
        await quiet(300);
      }
    })();
    await until('the client on the device', () => sent.some((m) => m.op === 'agent' && m.driving));
    const told = sent.find((m) => m.op === 'agent' && m.driving)!;
    expect(told.client).toBe(client.name);
    const words = await looked('driving');
    expect(words).toContain(
      language === 'tr' ? `${client.name} yönetiyor` : `${client.name} driving`,
    );
    await driving;
  });

  it('has its row say Connected, by that call and no other', async () => {
    sent.length = 0;
    await clickRow('AI Clients');
    await until('rows', () => sent.some((m) => m.rows));
    const { rows } = sent.find((m) => m.rows) as { rows: { name: string; state: string }[] };
    expect(rows.find((r) => r.name === client.name)!.state).toBe('connected');
    await looked('connected');
  });

  it('fills Help with the device last chosen, and gives the room back', async () => {
    await clickRow('Help');
    const words = await looked('help-filled');
    expect(words).toContain(language === 'tr' ? `${model} cihazında` : `On ${model}`);
    expect(words).toContain(language === 'tr' ? `${front} uygulamasının` : `of ${front}`);
    await clickRow(model);
    await until('the stream again', () => heard.some((m) => m.op === 'first'), 90_000);
    await looked('back');
  });
});
