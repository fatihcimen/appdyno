import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  symlinkSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { DEFAULT_POLICY, opsFor, ServerContext, writeDirsOf } from '../src/index.js';
import { inside, OUTPUT_FOLDERS, writeFolders } from '../src/writes.js';
import { connect } from './driving/shared.js';

/** Each tool that writes where its caller says, with the argument that says where. */
const WRITERS: [string, Record<string, unknown>, string][] = [
  ['take_screenshot', {}, 'file'],
  ['check_screen', { check: 'visual_baseline', name: 'home' }, 'dir'],
  ['check_screen', { check: 'visual', name: 'home' }, 'dir'],
  ['record_session', { kind: 'video', action: 'start' }, 'file'],
  ['record_session', { kind: 'report', action: 'start' }, 'dir'],
  ['record_session', { kind: 'report', action: 'write' }, 'dir'],
  ['record_session', { kind: 'timeline', action: 'start' }, 'dir'],
  ['record_session', { kind: 'flight', action: 'start' }, 'dir'],
  ['transfer_files', { action: 'pull' }, 'path'],
  ['capture_network', { action: 'read' }, 'save'],
  ['run_flow', { action: 'save' }, 'file'],
  ['run_flow', { action: 'stop' }, 'file'],
  ['run_flow', { action: 'export', file: 'a.flow' }, 'to'],
];

describe('a file a tool writes where its caller says', () => {
  let out: string;
  beforeEach(() => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'appdyno-writes-')));
    vi.stubEnv('APPDYNO_STATE_DIR', join(base, 'state'));
    out = join(base, 'out');
    mkdirSync(out);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('is refused outside the folders the server writes in, by every such tool, and none is read-only', async () => {
    const { call, ctx } = await connect(new FakeDevice(), { policy: { writeDirs: [] } });
    const ops = opsFor(ctx);
    for (const [tool, args, name] of WRITERS) {
      // a capture or a recording has to be there before its file is looked at: the flow tests have those refusals
      if (tool === 'capture_network' || tool === 'run_flow') continue;
      const said = `${tool} ${JSON.stringify(args)}`;
      expect(ops[tool]?.annotations.readOnlyHint, said).not.toBe(true);
      const ext = args.kind === 'video' ? 'mp4' : tool === 'run_flow' ? 'flow' : 'png';
      const to = join(out, name === 'file' ? `a.${ext}` : name === 'to' ? 'a.yaml' : 'sub');
      const r = await call(tool as 'take_screenshot', { ...args, [name]: to });
      expect(r.text, said).toMatch(
        /^POLICY_DENIED: .* is outside the folders this server writes to/,
      );
      expect(r.text, said).toContain('--allow-write');
    }
    expect(readdirSync(out)).toEqual([]);
  });

  it("is written in the project folder, the state folder's folders for what tools make and a folder the server was started with", () => {
    const policy = { writeDirs: writeDirsOf([out], {}) };
    expect(inside(policy, join(out, 'a.png'))).toBe(join(out, 'a.png'));
    expect(inside(DEFAULT_POLICY, 'a.png')).toBe(join(process.cwd(), 'a.png'));
    for (const folder of OUTPUT_FOLDERS)
      expect(inside(DEFAULT_POLICY, join(out, '..', 'state', folder, 'a.png'))).toContain(
        `/state/${folder}/a.png`,
      );
    expect(() => inside(DEFAULT_POLICY, join(out, 'a.png'))).toThrow(/outside/);
    // the folder itself is no file in it, and a link that leads out is out
    expect(() => inside(policy, out)).toThrow(/outside/);
    symlinkSync(tmpdir(), join(out, 'link'));
    expect(() => inside(policy, join(out, 'link', 'a.png'))).toThrow(/outside/);
    // a command line's own: the root of the disk has every path inside it
    expect(inside({ writeDirs: ['/'] }, join(out, 'a.png'))).toBe(join(out, 'a.png'));
    expect(inside({ writeDirs: ['/'] }, '/a.png')).toBe('/a.png');
    expect(writeDirsOf(['a'], { APPDYNO_ALLOW_WRITE: '/x:/y' })).toEqual([
      join(process.cwd(), 'a'),
      '/x',
      '/y',
    ]);
  });

  it("is refused in the rest of the state folder, by any name or link to it, whatever folder holds it: it is appdyno's own", () => {
    const state = join(out, '..', 'state');
    mkdirSync(join(state, 'handoff'), { recursive: true });
    // a link in a folder it writes in, to the state folder, and one in a folder for what tools make
    symlinkSync(state, join(out, 'state'));
    mkdirSync(join(state, 'video'));
    mkdirSync(join(state, 'claims'));
    symlinkSync(join(state, 'claims'), join(state, 'video', 'claims'));
    const own = [
      join(state, 'http-token'),
      join(state, 'conditions', 'emulator-5554.json'),
      join(state, 'claims', 'emulator-5554.json'),
      join(state, 'push', 'fcm.json'),
      join(state, 'handoff', 'emulator-5554.json.done'),
      join(state, 'handoff'),
      join(state, 'HANDOFF', 'emulator-5554.json'),
      join(state, 'Claims', 'emulator-5554.json'),
      join(state, 'videos.png'),
      join(out, 'state', 'claims', 'emulator-5554.json'),
      join(state, 'video', 'claims', 'emulator-5554.json'),
    ];
    // a server started with --allow-write on the disk's root or on the state folder holds it too
    for (const writeDirs of [[out], ['/'], [state]])
      for (const to of own)
        expect(() => inside({ writeDirs }, to), `${String(writeDirs)} ${to}`).toThrow(
          /is in appdyno's own state folder, where a tool writes only in exports, .*, video$/,
        );
    expect(inside({ writeDirs: ['/'] }, join(state, 'video', 'a.mp4'))).toContain(
      '/state/video/a.mp4',
    );
  });

  it('refuses a call that names a file of the state folder, and writes nothing there', async () => {
    const { call } = await connect(new FakeDevice(), { policy: { writeDirs: [] } });
    const r = await call('take_screenshot', { file: join(out, '..', 'state', 'push', 'a.png') });
    expect(r.text).toMatch(/^POLICY_DENIED: .* is in appdyno's own state folder/);
    expect(existsSync(join(out, '..', 'state', 'push'))).toBe(false);
  });

  it('takes a server started at the root of the disk or in the home folder as one with no project', () => {
    for (const cwd of ['/', homedir()]) {
      vi.spyOn(process, 'cwd').mockReturnValue(cwd);
      expect(writeFolders(DEFAULT_POLICY)).toEqual(
        OUTPUT_FOLDERS.map((f) => join(out, '..', 'state', f)),
      );
      expect(() => inside(DEFAULT_POLICY, join(homedir(), '.zshrc'))).toThrow(/outside/);
    }
  });

  it('holds every tool with a path of its own to write in this list', () => {
    const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
    const named = Object.values(ops).flatMap((op) =>
      Object.keys(op.input.shape)
        .filter((k) => ['file', 'dir', 'path', 'save', 'to', 'out', 'folder'].includes(k))
        .map((k) => `${op.name} ${k}`),
    );
    // a place on the screen, a measurement's id, and what install and build_and_run read
    const others = [
      'swipe_screen to',
      'compare_performance to',
      'manage_app path',
      'capture_network path',
    ];
    expect(named.sort()).toEqual(
      [...new Set(WRITERS.map(([tool, , k]) => `${tool} ${k}`)), ...others].sort(),
    );
    expect(existsSync(out)).toBe(true);
  });
});
