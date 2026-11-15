#!/usr/bin/env node
// The desktop extension: one .mcpb file a person opens to install appdyno in a desktop client. It is the npm package as
// `npm pack` makes it, with the manifest kept in packages/appdyno/mcpb, the tools the packed server itself lists, and
// the Mac app's icon, validated and packed by the official packer into `.app-build`. Unsigned:
//   pnpm build && node scripts/build-mcpb.mjs
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { must } from '@appdyno/core';
import { render } from './build-icons.mjs';
import { bundlePath, json, MCPB, parsed, run, strangerEnv, toolsOf } from './check-mcpb.mjs';
import { macIcon } from './icon-art.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(repo, 'packages/appdyno');
const temp = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-mcpb-')));
try {
  // the package as npm publishes it, its prepack's refusal of one with no Android agent with it
  const packed = /** @type {{ filename: string }[]} */ (
    parsed(run('npm', ['pack', '--json', '--pack-destination', temp], pkg))
  );
  run('tar', ['-xzf', join(temp, must(packed[0], "npm's pack").filename), '-C', temp]);
  const stage = join(temp, 'package');

  const kept = /** @type {{ version: string; icon: string }} */ (
    json(join(pkg, 'mcpb/manifest.json'))
  );
  const { version } = /** @type {{ version: string }} */ (json(join(stage, 'package.json')));
  if (kept.version !== version)
    throw new Error(`the manifest is ${kept.version}, and the package ${version}`);
  // from the server about to be packed, so that the list is never kept by hand
  const tools = await toolsOf(
    process.execPath,
    [join(stage, 'dist/main.js'), 'mcp'],
    strangerEnv(temp),
  );
  writeFileSync(join(stage, 'manifest.json'), `${JSON.stringify({ ...kept, tools }, null, 2)}\n`);
  // the size the packer asks for
  render(macIcon(512), join(stage, kept.icon));

  const out = bundlePath();
  mkdirSync(dirname(out), { recursive: true });
  rmSync(out, { force: true });
  console.log(run(MCPB, ['pack', stage, out]).trim());
  console.log(`${tools.length} tools in the manifest\n${out}`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
