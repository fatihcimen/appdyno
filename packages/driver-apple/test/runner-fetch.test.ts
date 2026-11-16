import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import {
  dropFetched,
  fetchedFor,
  fetchRunner,
  notFetched,
  type Here,
} from '../src/runner-fetch.js';

const ID = '0123456789abcdef';
const HERE: Here = { xcode: '26.5', arch: 'arm64', noFetch: false };
const XCTESTRUN = 'Runner_iphonesimulator26.5-arm64.xctestrun';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/**
 * A release with a runner's zip, served on this Mac's loopback as a release serves it, and a package that names it:
 * `said` changes what the package says of it.
 */
async function release(said: Record<string, unknown> = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'appdyno-fetch-'));
  const products = join(dir, 'products');
  mkdirSync(join(products, 'Debug-iphonesimulator/Runner-Runner.app'), { recursive: true });
  writeFileSync(join(products, XCTESTRUN), '');
  writeFileSync(join(products, 'Debug-iphonesimulator/Runner-Runner.app/Runner-Runner'), 'runner');
  const file = `appdyno-runner-simulator-${ID}.zip`;
  execFileSync('zip', ['-qr', join(dir, file), '.'], { cwd: products });
  const data = readFileSync(join(dir, file));
  const asked: string[] = [];
  const server = createServer((req, res) => {
    asked.push(req.url ?? '');
    if (req.url === `/${file}`) res.end(data);
    else res.writeHead(404).end();
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  onTestFinished(() => void server.close());
  vi.stubEnv('APPDYNO_RUNNER_URL', `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  const src = join(dir, 'ios-src');
  mkdirSync(src);
  const prebuilt = {
    version: '9.8.7',
    id: ID,
    file,
    sha256: createHash('sha256').update(data).digest('hex'),
    bytes: data.length,
    xcode: '26.5',
    ...said,
  };
  writeFileSync(join(src, 'prebuilt.json'), JSON.stringify(prebuilt));
  const lines: string[] = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((line) => {
    lines.push(String(line).trim());
    return true;
  });
  const builds = join(dir, 'state/ios-build', ID);
  return { src, out: join(builds, 'simulator'), builds, asked, lines, prebuilt };
}

describe("the release's simulator runner", () => {
  it('is fetched once into the folder a build would fill, and says so with its size and release', async () => {
    const { src, out, asked, lines } = await release();
    expect(await fetchRunner(src, ID, out, HERE)).toBe(true);
    const products = join(out, 'Build/Products');
    expect(readdirSync(products).sort()).toEqual(['Debug-iphonesimulator', XCTESTRUN]);
    expect(fetchedFor(products)).toBe('9.8.7');
    expect(asked).toEqual([`/appdyno-runner-simulator-${ID}.zip`]);
    expect(lines).toEqual(['fetched the simulator runner (0.0 MB) for v9.8.7']);
    // nothing of the fetch is left beside it
    expect(readdirSync(join(out, '..'))).toEqual(['simulator']);
  });

  it('is refused when its sha256 is not the one the package names, and nothing of it is kept', async () => {
    const { src, out, builds, asked, lines } = await release({ sha256: 'f'.repeat(64) });
    expect(await fetchRunner(src, ID, out, HERE)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(existsSync(builds)).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^the simulator runner is built here, not fetched: sha256 mismatch for /,
    );
  });

  it('is built here where the release has none, with the reason', async () => {
    const { src, out, lines } = await release({ file: 'gone.zip' });
    expect(await fetchRunner(src, ID, out, HERE)).toBe(false);
    expect(lines[0]).toContain('download failed (HTTP 404)');
  });

  it.each([
    ['the offline flag', {}, { noFetch: true }, 'APPDYNO_NO_FETCH is set'],
    ['other sources', { id: 'fedcba9876543210' }, {}, 'of other sources (fedcba9876543210)'],
    [
      'an Xcode two versions on',
      {},
      { xcode: '28.0' },
      'built by Xcode 26.5, and this is Xcode 28.0',
    ],
    ['an Xcode that says no version', {}, { xcode: undefined }, 'this is Xcode unknown'],
    ['an Intel Mac', {}, { arch: 'x64' }, 'Apple silicon'],
  ])(
    'is not asked for with %s: no request is made, and the reason is said',
    async (_, said, at, why) => {
      const { src, out, asked, lines } = await release(said);
      expect(await fetchRunner(src, ID, out, { ...HERE, ...at })).toBe(false);
      expect(asked).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(why);
      expect(existsSync(out)).toBe(false);
    },
  );

  it('is taken from an Xcode one version away, and by the same', async () => {
    const { prebuilt, out } = await release();
    for (const xcode of ['25.4', '26.0', '27.2'])
      expect(notFetched(prebuilt, ID, out, { ...HERE, xcode })).toBeUndefined();
    expect(notFetched(undefined, ID, out, HERE)).toBe('this build of appdyno names none');
  });

  it('that did not start is removed and not asked for again, and a build made here is left alone', async () => {
    const { src, out, asked, lines } = await release();
    await fetchRunner(src, ID, out, HERE);
    expect(await dropFetched(join(out, 'Build/Products', XCTESTRUN))).toBe(true);
    expect(existsSync(out)).toBe(false);
    expect(await fetchRunner(src, ID, out, HERE)).toBe(false);
    expect(asked).toHaveLength(1);
    expect(lines.at(-1)).toContain('the fetched one did not start on this Mac');

    const built = join(out, 'Build/Products');
    mkdirSync(built, { recursive: true });
    writeFileSync(join(built, XCTESTRUN), '');
    expect(await dropFetched(join(built, XCTESTRUN))).toBe(false);
    expect(existsSync(join(built, XCTESTRUN))).toBe(true);
    expect(fetchedFor(built)).toBeUndefined();
  });
});
