import { describe, expect, it } from 'vitest';
import { atosName, crashedFrames, parseUuids } from '../src/symbols.js';

describe('a crash report’s names', () => {
  it('reads a dSYM’s UUIDs, a line for each architecture, as a report writes them', () => {
    const out = `UUID: C828F7A9-54FC-36F2-ADF1-CBA17FA04A44 (arm64) /b/Fixture.app.dSYM/Contents/Resources/DWARF/Fixture
UUID: 4B5787B1-7653-314C-A747-E0ECC9AF10B6 (x86_64) /b/Fixture.app.dSYM/Contents/Resources/DWARF/Fixture
`;
    expect(parseUuids(out)).toEqual([
      {
        uuid: 'c828f7a9-54fc-36f2-adf1-cba17fa04a44',
        arch: 'arm64',
        path: '/b/Fixture.app.dSYM/Contents/Resources/DWARF/Fixture',
      },
      {
        uuid: '4b5787b1-7653-314c-a747-e0ecc9af10b6',
        arch: 'x86_64',
        path: '/b/Fixture.app.dSYM/Contents/Resources/DWARF/Fixture',
      },
    ]);
  });

  it('takes a function from atos, with its place only when it has a real one', () => {
    expect(atosName('fixtureCrash(_:) (in Fixture) (/<compiler-generated>:0)')).toBe(
      'fixtureCrash(_:)',
    );
    expect(atosName('load() (in Fixture) (FixtureApp.swift:201)')).toBe(
      'load() (FixtureApp.swift:201)',
    );
    expect(atosName('load() (in Fixture) + 76')).toBe('load()');
  });

  it('calls an address atos could not name no name', () => {
    expect(atosName('0x0000000100000000 (in Fixture)')).toBeUndefined();
    expect(atosName('0x104800000')).toBeUndefined();
  });

  it('reads the thread that crashed, each frame with its image', () => {
    const fixture = { uuid: 'c828', name: 'Fixture', base: 4370481152 };
    const text = `{"bug_type":"309"}\n${JSON.stringify({
      faultingThread: 1,
      usedImages: [fixture],
      threads: [
        { frames: [{ imageIndex: 0, imageOffset: 1 }] },
        { frames: [{ imageIndex: 0, imageOffset: 34256 }, { imageOffset: 2 }] },
      ],
    })}`;
    expect(crashedFrames(text)).toEqual([
      { frame: { imageIndex: 0, imageOffset: 34256 }, image: fixture },
      { frame: { imageOffset: 2 } },
    ]);
  });
});
