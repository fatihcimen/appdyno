import { DeviceError } from '@appdyno/protocol';
import { TIMEOUTS } from '@appdyno/core';
import { shortFirstLine } from './adb.js';
import { REMOTE_DIR } from './agent.js';

type Shell = (command: string, timeoutMs?: number) => Promise<string>;

const TEST_PROVIDERS = ['gps', 'network', 'fused'];
/** The attribution tag of our test providers (dumpsys location shows it in the provider's block). */
export const TEST_TAG = 'appdyno';

/**
 * The device side of setLocation: per provider, a probe of its test state (it fails unless the provider is
 * already a test provider: then it is used, `had`), else our add with our tag (`made`; `/plain` where this
 * release takes no tag), then the position.
 */
export function locationScript(at: string): string {
  const add = (p: string) =>
    `if cmd location providers add-test-provider ${p} --extraAttributionTags ${TEST_TAG} >/dev/null 2>&1; then echo "made ${p}"; ` +
    `elif cmd location providers add-test-provider ${p} >/dev/null 2>&1; then echo "made ${p}/plain"; fi`;
  return [
    'appops set com.android.shell android:mock_location allow',
    'cmd location set-location-enabled true',
    ...TEST_PROVIDERS.map(
      (p) =>
        `if cmd location providers set-test-provider-enabled ${p} true >/dev/null 2>&1; then echo "had ${p}"; else ${add(p)}; ` +
        `cmd location providers set-test-provider-enabled ${p} true; fi; ` +
        `cmd location providers set-test-provider-location ${p} --location ${at}`,
    ),
    'echo done',
  ].join('; ');
}

/** What locationScript said: the providers that were test providers already, and the ones it created. */
export function parseLocationRun(out: string): { had: string[]; made: string[] } {
  const had: string[] = [];
  const made: string[] = [];
  for (const m of out.matchAll(/^(had|made) (\w+(?:\/plain)?)\s*$/gm)) {
    const [, kind, entry] = m;
    if (!TEST_PROVIDERS.includes(entry!.split('/')[0]!)) continue;
    (kind === 'had' ? had : made).push(entry!);
  }
  return { had, made };
}

/** Each test provider's block in `dumpsys location` (`    gps provider [mock]:` and its indented lines). */
function mockBlocks(dumpsys: string): Map<string, string> {
  const blocks = new Map<string, string>();
  let current: string | undefined;
  for (const line of dumpsys.split(/\r?\n/)) {
    const head = /^(\s*)(\w+) provider( \[mock\])?:\s*$/.exec(line);
    if (head) {
      current = head[3] ? head[2] : undefined;
      if (current) blocks.set(current, '');
      continue;
    }
    if (current && /^\s{5,}\S/.test(line)) blocks.set(current, blocks.get(current)! + line + '\n');
    else if (current && line.trim()) current = undefined;
  }
  return blocks;
}

/**
 * Of the listed providers (`gps`, or `gps/plain` where no tag was taken), the ones that may be removed now:
 * still a test provider, and carrying our tag when it was created with one (a provider replaced since
 * by someone else's is not ours any more).
 */
export function removableProviders(listed: string[], dumpsys: string): string[] {
  const blocks = mockBlocks(dumpsys);
  const tagged = new RegExp(`extra attribution tags=\\{[^}]*\\b${TEST_TAG}\\b`);
  return listed.flatMap((entry) => {
    const [p, kind] = entry.split('/');
    const block = blocks.get(p!);
    if (block === undefined) return [];
    return kind === 'plain' || tagged.test(block) ? [p!] : [];
  });
}
/** The test location providers this library added: `<host pid> <provider>…`. */
export const TEST_LOCATION = `${REMOTE_DIR}/test-location`;

/** The host process and the providers of a TEST_LOCATION file; nothing when it is missing or not ours. */
export function parseTestLocation(text: string): { pid?: number; providers: string[] } {
  const [pid, ...rest] = text.trim().split(/\s+/);
  if (!pid || !/^\d+$/.test(pid)) return { providers: [] };
  return {
    pid: Number(pid),
    providers: rest.filter(
      (e) => /^\w+(\/plain)?$/.test(e) && TEST_PROVIDERS.includes(e.split('/')[0]!),
    ),
  };
}

/** Whether a process of this Mac still runs (a host that set the location and has not gone). */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it runs, as another user
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * A fixed position through test location providers (gps, network, fused: apps read fused as often as
 * gps; the shell user's mock-location right). A provider is ours only when our own add created it: a
 * provider that is already a test provider (the probe of its state succeeds) is used and never added
 * or listed, whatever a snapshot of the device's providers showed. Ours carry the tag TEST_TAG and are
 * listed on the device (TEST_LOCATION, with this host's process); clearing, stopping the agent and the next
 * agent start once this process is gone remove them, each only after reading again that the provider
 * is still a test provider with our tag.
 */
export async function setTestLocation(shell: Shell, lat: number, lon: number) {
  const at = `${lat.toFixed(6)},${lon.toFixed(6)}`;
  const before = await readMarker(shell);
  const out = await shell(locationScript(at), TIMEOUTS.app);
  if (!out.trim().endsWith('done') || /Unknown command|No shell command/i.test(out))
    throw new DeviceError(
      'UNSUPPORTED',
      `this device refused the test location: ${shortFirstLine(out)}`,
    );
  const run = parseLocationRun(out);
  // still ours: what this call created, and what an earlier call of this process created that is still there
  const kept =
    before.pid === process.pid
      ? before.providers.filter((e) => run.had.includes(e.split('/')[0]!))
      : [];
  await shell(
    `mkdir -p ${REMOTE_DIR}; echo ${process.pid} ${[...kept, ...run.made].join(' ')} > ${TEST_LOCATION}`,
  );
}

const readMarker = async (shell: Shell) =>
  parseTestLocation(await shell(`cat ${TEST_LOCATION} 2>/dev/null`));

async function removeProviders(shell: Shell, listed: string[]) {
  const ours = removableProviders(listed, await shell('dumpsys location', TIMEOUTS.app));
  await shell(
    [
      ...ours.map((p) => `cmd location providers remove-test-provider ${p}`),
      `rm -f ${TEST_LOCATION}`,
    ].join('; '),
    TIMEOUTS.app,
  );
}

/** Removes the test location providers setTestLocation created, and only those still ours on a fresh read. */
export async function clearTestLocation(shell: Shell) {
  await removeProviders(shell, (await readMarker(shell)).providers);
}

/** At a new agent's start: the test providers of a host process that is gone (it died before clearing). */
export async function clearStaleTestLocation(shell: Shell) {
  const marker = await readMarker(shell);
  if (marker.pid === undefined || processAlive(marker.pid)) return;
  await removeProviders(shell, marker.providers);
}
