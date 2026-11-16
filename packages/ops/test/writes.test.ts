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
import { inside, writeFolders } from '../src/writes.js';
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

  it('is written in the project folder, the state folder and a folder the server was started with', () => {
    const policy = { writeDirs: writeDirsOf([out], {}) };
    expect(inside(policy, join(out, 'a.png'))).toBe(join(out, 'a.png'));
    expect(inside(DEFAULT_POLICY, 'a.png')).toBe(join(process.cwd(), 'a.png'));
    expect(inside(DEFAULT_POLICY, join(out, '..', 'state', 'a.png'))).toContain('/state/a.png');
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

  it('takes a server started at the root of the disk or in the home folder as one with no project', () => {
    for (const cwd of ['/', homedir()]) {
      vi.spyOn(process, 'cwd').mockReturnValue(cwd);
      expect(writeFolders(DEFAULT_POLICY)).toEqual([join(out, '..', 'state')]);
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
