#!/usr/bin/env node
// What a user's machine does with the package: the tarball installed on an empty HOME with only Node and
// the platform's tools on PATH, then `npx appdyno mcp` over stdio. It drives only the devices named here:
//   pnpm build && node scripts/check-package.mjs [--android <serial>] [--ios <udid>] [--keep]
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { must } from '@appdyno/core';

const { values: flags } = parseArgs({
  options: {
    android: { type: 'string' },
    ios: { type: 'string' },
    keep: { type: 'boolean' },
  },
});

/** @param {string} why */
const refuse = (why) => {
  console.error(`refused: ${why}`);
  process.exit(2);
};

function adbDir() {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- a command that cannot start has no stdout, whatever its types say
  const onPath = spawnSync('which', ['adb'], { encoding: 'utf8' }).stdout?.trim();
  return [
    process.env.ANDROID_HOME && join(process.env.ANDROID_HOME, 'platform-tools'),
    process.env.HOME && join(process.env.HOME, 'Library/Android/sdk/platform-tools'),
    onPath && dirname(realpathSync(onPath)),
  ].find((d) => d && existsSync(join(d, 'adb')));
}

const nodeDir = dirname(process.execPath);
if (!existsSync(join(nodeDir, 'npx'))) refuse(`no npx beside node in ${nodeDir}`);
const adb = adbDir();
if (flags.android && !adb) refuse('no adb: set ANDROID_HOME');
const PATH = [nodeDir, '/usr/bin', '/bin', '/usr/sbin', '/sbin', ...(adb ? [adb] : [])].join(':');
if (PATH.split(':').some((d) => existsSync(join(d, 'pnpm'))))
  refuse(`pnpm is on ${PATH}: use a node whose folder has none`);
// by running it: /usr/bin/java is on every Mac, a stub that fails without a JDK
if (spawnSync('java', ['-version'], { env: { PATH }, stdio: 'ignore' }).status === 0)
  refuse(`java runs on ${PATH}: use a node whose folder has none`);

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-check-')));
const HOME = join(temp, 'home');
const project = join(temp, 'project');
for (const d of [HOME, project, join(temp, 'tmp')]) mkdirSync(d);
const env = {
  HOME,
  PATH,
  TMPDIR: join(temp, 'tmp'),
  // a registry that answers nothing: a step that needs one fails here
  npm_config_registry: 'http://127.0.0.1:9',
  ...(process.env.DEVELOPER_DIR && { DEVELOPER_DIR: process.env.DEVELOPER_DIR }),
};

/**
 * @template {string | void} T
 * @param {string} name
 * @param {() => T | Promise<T>} fn
 */
async function step(name, fn) {
  const started = performance.now();
  const said = await fn();
  const ms = Math.round(performance.now() - started);
  console.log(`ok   ${name} ${ms} ms${typeof said === 'string' && said !== '' ? `: ${said}` : ''}`);
  return said;
}

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {string} cwd
 */
function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${String(r.stderr || r.error)}`);
  return r.stdout;
}

/**
 * @template T
 * @param {string[]} args
 * @param {(client: Client) => Promise<T>} use
 */
async function serve(args, use, revision = '2025-11-25') {
  const client = new Client(
    { name: 'check-package', version: '1' },
    revision === '2026-07-28' ? { versionNegotiation: { mode: { pin: revision } } } : {},
  );
  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['appdyno', 'mcp', ...args],
    env,
    cwd: project,
    stderr: 'inherit',
  });
  await client.connect(transport);
  try {
    return await use(client);
  } finally {
    await client.close();
  }
}

/** @param {Awaited<ReturnType<Client['callTool']>>} answer */
const textOf = (answer) =>
  answer.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

/**
 * @param {string} device
 * @param {string} app
 * @param {string[]} keys
 */
async function drive(device, app, keys) {
  await serve(['--device', device], async (client) => {
    let notifications = 0;
    // a first use may build the runner: long, and alive as long as progress comes
    /** @param {string} name */
    const call = async (name, args = {}) => {
      // set inside the step, where the compiler does not follow it
      let answer = /** @type {Awaited<ReturnType<Client['callTool']>> | undefined} */ (undefined);
      await step(`${device} ${name}`, async () => {
        answer = await client.callTool(
          { name, arguments: args },
          {
            timeout: 20 * 60_000,
            resetTimeoutOnProgress: true,
            onprogress: (p) => {
              notifications++;
              console.log(`     progress: ${p.message ?? p.progress}`);
            },
          },
        );
        if (answer.isError) throw new Error(`${name}: ${textOf(answer)}`);
      });
      return must(answer, `the answer of ${name}`);
    };
    await call('device_info');
    await call('screen');
    await call('launch_app', { app });
    const screen = textOf(await call('screen'));
    // Settings' rows may all be tappable, without a button among them
    const ref = /^(@\S+) button /m.exec(screen) ?? /^(@\S+) tappable /m.exec(screen);
    if (!ref) throw new Error(`nothing to tap on the screen:\n${screen}`);
    await call('tap', { ref: ref[1] });
    for (const key of keys) await call('press_key', { key });
    const shot = await call('screenshot');
    if (!shot.content.some((c) => c.type === 'image' && c.data)) throw new Error('no image');
    console.log(`     ${notifications} progress notifications`);
  });
}

/**
 * A runner outlives its server: stopped here, or it would run on from files about to go.
 * @param {string} udid
 */
function stopRunner(udid) {
  const state = join(HOME, 'Library/Caches/appdyno', `ios-${udid}.json`);
  if (!existsSync(state)) return;
  try {
    /** @type {unknown} */
    const runner = JSON.parse(readFileSync(state, 'utf8'));
    process.kill(/** @type {{ pid: number }} */ (runner).pid, 'SIGTERM');
  } catch {
    /* gone already */
  }
}

try {
  console.log(`PATH=${PATH}`);
  const tarball = await step('npm pack', () => {
    /** @type {unknown} */
    const packed = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', temp], join(repo, 'packages/appdyno')),
    );
    const [pack] = /** @type {{ files: { path: string }[]; filename: string }[]} */ (packed);
    const files = must(pack, "npm's pack").files.map((f) => f.path);
    for (const f of [
      'dist/main.js',
      'dist/index.js',
      'dist/index.d.ts',
      'README.md',
      'LICENSE',
      'THIRD_PARTY_NOTICES',
      'agents/android/agent.apk',
      'agents/ios-src/Appdyno.xcodeproj/project.pbxproj',
    ])
      if (!files.includes(f)) throw new Error(`${f} is not in the package: pnpm build first`);
    if (files.some((f) => f.includes('mirror-src/SelfTest')))
      throw new Error("the viewer's self test is in the package");
    return join(temp, must(pack, "npm's pack").filename);
  });
  await step('npm install, no registry', () => {
    writeFileSync(join(project, 'package.json'), '{ "private": true }\n');
    run('npm', ['install', '--offline', '--no-audit', '--no-fund', tarball], project);
    const installed = readdirSync(join(project, 'node_modules')).filter((f) => !f.startsWith('.'));
    if (installed.join() !== 'appdyno') throw new Error(`installed: ${installed.join(' ')}`);
    const dist = join(project, 'node_modules/appdyno/dist');
    for (const f of readdirSync(dist, { recursive: true, encoding: 'utf8' }))
      if (f.endsWith('.d.ts') && readFileSync(join(dist, f), 'utf8').includes('@appdyno/'))
        throw new Error(`${f} names a workspace package`);
  });
  await step('appdyno --help', () => {
    const r = spawnSync('npx', ['appdyno', '--help'], { cwd: project, env, encoding: 'utf8' });
    if (!`${r.stdout}${r.stderr}`.includes('usage: appdyno'))
      throw new Error(`no usage line: ${String(r.stderr || r.error)}`);
  });
  await step('tools/list over stdio, on each revision', async () => {
    /** @type {string[]} */
    const lists = [];
    for (const revision of ['2025-11-25', '2026-07-28'])
      lists.push(
        await serve([], async (c) => JSON.stringify((await c.listTools()).tools), revision),
      );
    const [first = '', second] = lists;
    if (first !== second) throw new Error('2025-11-25 and 2026-07-28 list other tools');
    /** @type {unknown} */
    const tools = JSON.parse(first);
    const count = /** @type {unknown[]} */ (tools).length;
    if (count === 0) throw new Error('no tools');
    return `${count} tools, ${first.length} bytes, the same on 2025-11-25 and 2026-07-28`;
  });
  if (flags.android) {
    // the adb server outlives this run: it starts under the real HOME, not one about to go
    spawnSync(join(String(adb), 'adb'), ['start-server'], { stdio: 'ignore' });
    await drive(flags.android, 'com.android.settings', ['back']);
  }
  if (flags.ios) await drive(flags.ios, 'com.apple.Preferences', []);
  console.log('passed');
} catch (e) {
  console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
} finally {
  if (flags.keep) console.log(`kept ${temp}`);
  else {
    if (flags.ios) stopRunner(flags.ios);
    rmSync(temp, { recursive: true, force: true });
  }
}
