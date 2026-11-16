#!/usr/bin/env node
// What a desktop client does with the extension: the .mcpb unpacked into a folder of its own, and its server run over
// stdio by the manifest's own command, arguments and variables, on an empty HOME with only Node and the system on PATH.
// Run for an install form left empty, as the packer's own substitution and as a client that leaves a field's
// placeholder where it was, for one filled in, and for each field given what the server refuses, which must stop it
// from starting: a field that reached nothing would start. It touches no device:
//   pnpm build && node scripts/build-mcpb.mjs && node scripts/check-mcpb.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMcpConfigForManifest } from '@anthropic-ai/mcpb';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { must } from '@appdyno/core';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The official packer, validator and signer. */
export const MCPB = join(repo, 'node_modules/.bin/mcpb');

/** @param {string} text */
export const parsed = (text) => /** @type {unknown} */ (JSON.parse(text));
/** @param {string} file */
export const json = (file) => parsed(readFileSync(file, 'utf8'));

/** Where a build leaves the extension, by the package's version. */
export function bundlePath() {
  const { version } = /** @type {{ version: string }} */ (
    json(join(repo, 'packages/appdyno/package.json'))
  );
  return join(repo, '.app-build', `appdyno-${version}.mcpb`);
}

/**
 * A home with nothing in it, and a PATH with this Node and the system alone.
 * @param {string} temp
 */
export function strangerEnv(temp) {
  const HOME = join(temp, 'home');
  mkdirSync(HOME, { recursive: true });
  const PATH = [dirname(process.execPath), '/usr/bin', '/bin', '/usr/sbin', '/sbin'].join(':');
  return { HOME, PATH, TMPDIR: temp };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} [cwd]
 */
export function run(command, args, cwd) {
  const r = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0)
    throw new Error(`${command} ${args.join(' ')}: ${String(r.stderr || r.stdout || r.error)}`);
  return r.stdout;
}

/**
 * The tools a server lists over stdio, each by its name and what it says of itself.
 * @param {string} command
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
export async function toolsOf(command, args, env) {
  const client = new Client({ name: 'check-mcpb', version: '1' });
  await client.connect(
    new StdioClientTransport({ command, args, env, cwd: env.HOME, stderr: 'inherit' }),
  );
  try {
    const { tools } = await client.listTools();
    return tools.map(({ name, description = '' }) => ({ name, description }));
  } finally {
    await client.close();
  }
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
const filesIn = (dir) =>
  readdirSync(dir, { recursive: true, withFileTypes: true, encoding: 'utf8' })
    .filter((f) => f.isFile())
    .map((f) => join(f.parentPath, f.name).slice(dir.length + 1));

async function main() {
  const bundle = bundlePath();
  const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-mcpb-check-')));
  try {
    const unpacked = join(temp, 'extension');
    run(MCPB, ['unpack', bundle, unpacked]);
    const manifest = /** @type {import('@anthropic-ai/mcpb').McpbManifestAny} */ (
      json(join(unpacked, 'manifest.json'))
    );
    // the packer leaves out what it takes for a developer's: of this package, only the library's types
    const have = new Set(filesIn(unpacked));
    const packed = /** @type {{ files: { path: string }[] }[]} */ (
      parsed(run('npm', ['pack', '--dry-run', '--json'], join(repo, 'packages/appdyno')))
    );
    const missing = must(packed[0], "npm's pack")
      .files.map((f) => f.path)
      .filter((f) => !have.has(f) && !f.endsWith('.d.ts'));
    if (missing.length > 0)
      throw new Error(`the package has, and the extension has not: ${missing.join(' ')}`);
    if (!have.has(must(manifest.icon, "the manifest's icon")))
      throw new Error('the extension has no icon');
    console.log(`ok   ${have.size} files, all the package's but its .d.ts, and the icon`);

    const want = JSON.stringify(manifest.tools);
    const env = strangerEnv(temp);
    const placeholders = must(manifest.server.mcp_config, "the manifest's server");
    /**
     * The server's command for a form, by the packer's own substitution.
     * @param {Record<string, string>} userConfig
     */
    const filled = async (userConfig) =>
      must(
        await getMcpConfigForManifest({
          manifest,
          extensionPath: unpacked,
          systemDirs: { HOME: env.HOME },
          userConfig,
          pathSeparator: '/',
        }),
        "the server's command",
      );
    /** @param {{ command: string; args?: string[]; env?: Record<string, string> }} config */
    const served = (config) =>
      toolsOf(config.command, config.args ?? [], { ...env, ...config.env });
    const forms = {
      'a form left empty': await filled({}),
      'a form left empty, its placeholders left as they were': {
        ...placeholders,
        args: (placeholders.args ?? []).map((a) => a.replace('${__dirname}', unpacked)),
      },
      'a form filled in': await filled({
        allow_devices: '^emulator-5554$',
        allow_apps: 'com.example.shop, com.example.shop.dev',
        allow_urls: '^https://staging\\.example\\.com/',
        allow_write: '~/Desktop/appdyno',
      }),
    };
    // each field reaches the server: what it refuses of a flag, it refuses of the field, and does not start
    for (const [field, refused] of Object.entries({
      allow_devices: 'a|',
      allow_apps: ' , ',
      allow_urls: '.*',
      allow_write: 'shots',
      toolsets: 'core, everything',
    })) {
      const started = await served(await filled({ [field]: refused })).then(
        () => true,
        () => false,
      );
      if (started) throw new Error(`${field}: the server started with ${refused}`);
      console.log(`ok   ${field} given ${JSON.stringify(refused)}: the server refuses to start`);
    }
    for (const [form, config] of Object.entries(forms)) {
      const tools = await served(config);
      if (tools.length === 0) throw new Error(`${form}: no tools`);
      if (JSON.stringify(tools) !== want)
        throw new Error(`${form}: tools/list and the manifest's tools differ`);
      console.log(
        `ok   ${form}: ${config.command} ${(config.args ?? []).join(' ').replace(unpacked, '${__dirname}')} ${JSON.stringify(config.env)}: ${tools.length} tools, the manifest's`,
      );
    }
    // a form that names groups lists their tools and no other
    const few = await served(await filled({ toolsets: 'core, perf' }));
    const all = (await served(forms['a form left empty'])).map((t) => t.name);
    const names = few.map((t) => t.name);
    if (names.length === 0 || names.length >= all.length || names.some((n) => !all.includes(n)))
      throw new Error(`toolsets core, perf: listed ${names.join(', ')}`);
    console.log(`ok   toolsets given "core, perf": ${names.length} of the ${all.length} tools`);
    console.log('passed');
  } catch (e) {
    console.error(`FAILED: ${e instanceof Error ? e.message : String(e)}`);
    process.exitCode = 1;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
