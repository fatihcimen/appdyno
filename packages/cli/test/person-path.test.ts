import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { must } from '@appdyno/core';
import { CLIENTS } from '../src/clients.js';
import { outcomeFor } from '../src/install.js';
import { commandIn, DOCK_PATH, forTheDock, pathOf, shellPath } from '../src/person-path.js';

const dir = mkdtempSync(join(tmpdir(), 'appdyno-person-path-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A shell of a test's own: what it prints as it starts, then what it runs. */
function shell(name: string, body: string) {
  const file = join(dir, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
  return file;
}

describe("a person's PATH", () => {
  it("is read between marks, whatever a shell's start prints around it", async () => {
    const chatty = shell(
      'chatty',
      'echo "Welcome back"\nPATH=/opt/tools/bin:/usr/bin\nexport PATH\nshift 3\nexec /bin/sh -c "$1"',
    );
    expect(await shellPath(chatty, dir)).toBe('/opt/tools/bin:/usr/bin');
  });

  it('is none from a shell that hangs as it starts, or fails', async () => {
    expect(await shellPath(shell('hangs', 'sleep 30'), dir, 300)).toBeUndefined();
    expect(await shellPath(shell('fails', 'exit 3'), dir)).toBeUndefined();
    expect(await shellPath(join(dir, 'none'), dir)).toBeUndefined();
  });

  it('keeps each folder once, and only those there are', () => {
    const here = join(dir, 'bin');
    mkdirSync(here, { recursive: true });
    expect(pathOf([here, '/no/such/place', here, undefined, '/usr/bin'])).toBe(`${here}:/usr/bin`);
  });

  it('gives a client opened from the Dock its command whole, with a PATH that has Node', () => {
    const bin = join(dir, 'node-bin');
    mkdirSync(bin, { recursive: true });
    for (const tool of ['npx', 'node']) writeFileSync(join(bin, tool), '');
    const npx = { command: 'npx', args: ['-y', 'appdyno', 'mcp'] };
    expect(forTheDock(npx, `/usr/bin:${bin}`)).toEqual({
      ...npx,
      command: join(bin, 'npx'),
      env: { PATH: `${bin}:${DOCK_PATH}` },
    });
    const app = {
      command: '/Applications/Appdyno.app/Contents/Resources/bin/appdyno',
      args: ['mcp'],
    };
    expect(forTheDock(app, bin)).toBe(app);
    // where it is nowhere, the entry stays as asked, and a test of it says why
    expect(forTheDock(npx, '/usr/bin')).toBe(npx);
  });

  it('is what Connect writes for a client opened from the Dock', () => {
    const desktop = must(
      CLIENTS.find((c) => c.dock),
      'a client opened from the Dock',
    );
    const bin = join(dir, 'node-bin');
    const file = join(dir, 'desktop.json');
    const plan = outcomeFor(desktop, file, { env: { PATH: bin } });
    const written = JSON.parse(plan.after) as Record<string, Record<string, { command: string }>>;
    expect(written[desktop.key]?.appdyno?.command).toBe(join(bin, 'npx'));
  });

  it('finds a command by its name, and leaves a path as it is', () => {
    const bin = join(dir, 'tools');
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, 'npx'), '');
    expect(commandIn(`/no/such:${bin}`, 'npx')).toBe(join(bin, 'npx'));
    expect(commandIn(bin, 'claude')).toBeUndefined();
    expect(commandIn('', '/opt/x/claude')).toBe('/opt/x/claude');
  });
});
