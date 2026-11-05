import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { functionOf, nameFrames, nameFramesOf, renamed } from '../src/frame-names.js';
import { parseTimeProfile } from '../src/trace-parse.js';

const APP = '/private/var/containers/Bundle/Application/X/Fixture.app/Fixture';

/** As Xcode 27 exports it: a binary written out once, then by `ref`, with one frame of the system's between. */
const TABLE = `<node><row><weight id="1" fmt="1 ms">1000000</weight><process id="2" fmt="Fixture (9)"/><tagged-backtrace id="3"><frame id="4" name="0x100391dc3" addr="0x100391dc3"><binary id="5" name="Fixture" UUID="B3F657C6-7B6F-3E5D-B2E8-67479CC913F9" arch="arm64" load-addr="0x100380000" path="${APP}"/></frame><frame id="6" name="0x18d05a915" addr="0x18d05a915"><binary id="7" name="libsystem" UUID="AAAA" arch="arm64e" load-addr="0x18d000000" path="/usr/lib/libsystem"/></frame><frame id="8" name="0x100391f00" addr="0x100391f00"><binary ref="5"/></frame></tagged-backtrace></row></node>`;

describe('a build’s names for its frames', () => {
  it('names the frames of that binary, by address, and no other', () => {
    const xml = renamed(
      TABLE,
      '5',
      new Map([
        ['0x100391dc3', 'busyMainThread()'],
        ['0x100391f00', 'closure #1 in <Screen>'],
      ]),
    );
    expect(xml).toContain('name="busyMainThread()" addr="0x100391dc3"');
    expect(xml).toContain('name="closure #1 in &lt;Screen&gt;" addr="0x100391f00"');
    expect(xml).toContain('name="0x18d05a915"');
  });

  it('leaves an address the dSYM has no name for', () => {
    const xml = renamed(TABLE, '5', new Map([['0x100391f00', 'busyMainThread()']]));
    expect(xml).toContain('name="0x100391dc3" addr="0x100391dc3"');
    expect(xml).toContain('name="busyMainThread()" addr="0x100391f00"');
  });

  it('reads through to the profile, escapes and all', () => {
    const xml = renamed(TABLE, '5', new Map([['0x100391f00', 'closure #1 in <Screen>']]));
    expect(parseTimeProfile(xml, 9).appTop.map((e) => e.symbol)).toContain(
      'closure #1 in &lt;Screen&gt;',
    );
  });

  it('keeps the function of a line, so one function is one row', () => {
    expect(functionOf('busyMainThread() (FixtureApp.swift:201)')).toBe('busyMainThread()');
    expect(functionOf('closure #1 in Foo.bar(_:) (Foo.swift:9)')).toBe('closure #1 in Foo.bar(_:)');
    expect(functionOf('-[Foo bar:]')).toBe('-[Foo bar:]');
  });

  it('asks no dSYM of a process that ran none of its own code', async () => {
    await expect(nameFramesOf(TABLE, 77, '/nowhere/Fixture.dSYM')).resolves.toBe(TABLE);
    await expect(nameFramesOf(TABLE, 9, '/nowhere/Fixture.dSYM')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('refuses a path with no dSYM in it, by name', async () => {
    await expect(nameFrames(TABLE, '/nowhere/Fixture.dSYM')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('no such dSYM or folder: /nowhere/Fixture.dSYM'),
    });
  });

  it('refuses a dSYM of another build, rather than naming the wrong thing', async () => {
    const dsym = join(mkdtempSync(join(tmpdir(), 'appdyno-dsym-')), 'Other.dSYM');
    const dwarfs = join(dsym, 'Contents/Resources/DWARF');
    mkdirSync(dwarfs, { recursive: true });
    // a real Mach-O, so with a UUID of its own, which this trace has not
    copyFileSync('/usr/bin/true', join(dwarfs, 'Other'));
    await expect(nameFrames(TABLE, dsym)).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: expect.stringContaining('is of no build in this trace'),
    });
  });
});
