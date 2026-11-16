import { createHash } from 'node:crypto';
import { DeviceError } from '@appdyno/protocol';

/** A file from the network, whole, or a refusal that says why none came. */
async function download(url: string, timeoutMs: number) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${String(res.status)}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (e) {
    // offline, a proxy that refuses or holds it, a release that is gone: fetch says which in its cause
    const why = e instanceof Error && e.cause instanceof Error ? e.cause : e;
    const said = why instanceof Error ? why.message : String(why);
    throw new DeviceError('OFFLINE', `download failed (${said}): ${url}`);
  }
}

/** A file from the network that is the one `sha256` names: one whose hash differs is refused, and never used. */
export async function downloadPinned(url: string, sha256: string, timeoutMs: number) {
  const data = await download(url, timeoutMs);
  const sha = createHash('sha256').update(data).digest('hex');
  if (sha !== sha256) throw new DeviceError('POLICY_DENIED', `sha256 mismatch for ${url}: ${sha}`);
  return data;
}
