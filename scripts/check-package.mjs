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
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const { values: flags } = parseArgs({
  options: {
    android: { type: 'string' },
    ios: { type: 'string' },
    keep: { type: 'boolean' },
  },
});

const refuse = (why) => {
  console.error(`refused: ${why}`);
  process.exit(2);
};

function adbDir() {
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

async function step(name, fn) {
  const started = performance.now();
  const said = await fn();
  const ms = Math.round(performance.now() - started);
  console.log(`ok   ${name} ${ms} ms${said ? `: ${said}` : ''}`);
  return said;
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, env, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}: ${r.stderr || r.error}`);
  return r.stdout;
}

async function serve(args, use) {
  const client = new Client({ name: 'check-package', version: '1' });
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

const textOf = (answer) =>
  answer.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text)
    .join('\n');

async function drive(device, app, keys) {
  await serve(['--device', device], async (client) => {
    let notifications = 0;
    // a first use may build the runner: long, and alive as long as progress comes
    const call = async (name, args = {}) => {
      /** @type {any} */
      let answer;
      await step(`${device} ${name}`, async () => {
        answer = await client.callTool({ name, arguments: args }, undefined, {
          timeout: 20 * 60_000,
          resetTimeoutOnProgress: true,
          onprogress: (p) => {
            notifications++;
            console.log(`     progress: ${p.message ?? p.progress}`);
          },
        });
        if (answer.isError) throw new Error(`${name}: ${textOf(answer)}`);
      });
      return answer;
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

/** A runner outlives its server: stopped here, or it would run on from files about to go. */
function stopRunner(udid) {
  const state = join(HOME, 'Library/Caches/appdyno', `ios-${udid}.json`);
  if (!existsSync(state)) return;
  try {
    process.kill(JSON.parse(readFileSync(state, 'utf8')).pid, 'SIGTERM');
  } catch {
    /* gone already */
  }
}

try {
  console.log(`PATH=${PATH}`);
  const tarball = await step('npm pack', () => {
    const [pack] = JSON.parse(
      run('npm', ['pack', '--json', '--pack-destination', temp], join(repo, 'packages/appdyno')),
    );
    const files = pack.files.map((f) => f.path);
    for (const f of [
      'dist/main.js',
      'dist/mcp-bin.js',
      'dist/index.js',
      'dist/index.d.ts',
      'README.md',
      'THIRD_PARTY_NOTICES',
      'agents/android/agent.apk',
      'agents/ios-src/Appdyno.xcodeproj/project.pbxproj',
    ])
      if (!files.includes(f)) throw new Error(`${f} is not in the package: pnpm build first`);
    return join(temp, pack.filename);
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
      throw new Error(`no usage line: ${r.stderr || r.error}`);
  });
  await step('tools/list over stdio', () =>
    serve([], async (client) => {
      const { tools } = await client.listTools();
      if (tools.length === 0) throw new Error('no tools');
      return `${tools.length} tools, ${JSON.stringify(tools).length} bytes`;
    }),
  );
  if (flags.android) {
    // the adb server outlives this run: it starts under the real HOME, not one about to go
    spawnSync(join(String(adb), 'adb'), ['start-server'], { stdio: 'ignore' });
    await drive(flags.android, 'com.android.settings', ['back']);
  }
  if (flags.ios) await drive(flags.ios, 'com.apple.Preferences', []);
  console.log('passed');
} catch (e) {
  console.error(`FAILED: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (flags.keep) console.log(`kept ${temp}`);
  else {
    if (flags.ios) stopRunner(flags.ios);
    rmSync(temp, { recursive: true, force: true });
  }
}
