import type { Device, NetworkPath, NetworkVia, ViewerMessage } from '@appdyno/core';
import { captures } from '@appdyno/ops';
import { frontApp, type WindowSession } from './controls.js';
import type { windowSends } from './window-sends.js';

type Call = ReturnType<typeof windowSends>['call'];

/** How often a probe's requests are read while the pane shows: it writes them to a file on this Mac. */
const PROBE_LOOK_MS = 3_000;
const MOST = 200;
/** The ways that list requests; the others count bytes. */
const REQUESTS: readonly NetworkVia[] = ['probe', 'proxy'];
export const IPHONE_NEEDS =
  "An iPhone's requests show only through a proxy you run, such as Proxyman, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone.";
export const ANDROID_NEEDS =
  'Requests show only through a proxy you run, such as Proxyman, set on this device. This window changes no proxy: without one it counts what the app sends and receives.';
export const PROBE_WHILE =
  'The probe restarts the app: stop the recording first, or wait for the measure to end';
const NO_APP = 'Open an app of yours to capture its requests';
const PACKETS_LATER = 'Packets are counted when the capture stops';

/**
 * Each request with where it stands since the capture began, which the next read keeps as the oldest go: a window keeps
 * the one a person chose by it, where its place in the list moves.
 */
const numbered = (data: Record<string, unknown>) =>
  ((data.entries as Record<string, unknown>[] | undefined) ?? []).map((e, i) => ({
    ...e,
    id: Number(data.dropped ?? 0) + i,
  }));

/**
 * A window's Network pane: the capture `network` keeps for the device, read by that op so an agent's and the pane's are
 * one, and the ways the device has. A proxy is offered only where the device already goes through one: no window sets one.
 */
export function windowNetwork(
  device: Device,
  session: () => Pick<WindowSession, 'tell'>,
  call: Call,
  o: { recording(): boolean; measuring(): boolean },
) {
  const { serial } = device;
  let wanted = false;
  let ours = false;
  let reading = false;
  let looking: NodeJS.Timeout | undefined;
  const tell = (m: Record<string, unknown>) => session().tell({ op: 'network', ...m });
  const answer = (m: Record<string, unknown>) =>
    session().tell({ op: 'answer', name: 'network', ...m });
  const op = (args: Record<string, unknown>) =>
    call('network', 'network', { ...args, limit: MOST });

  /** What this device can see, read from it alone: listing them opens no session, and starts no agent. */
  const ways = async () => {
    const own: NetworkPath[] = (await device.network?.paths().catch(() => [])) ?? [];
    const proxy = await device.settings.get('proxy').catch(() => 'none');
    // the device's own first: a proxy the Mac or the device goes through is a person's, and is offered last
    const usable = [
      ...own.filter((p) => !p.refused).map((p) => p.via),
      ...(proxy === 'none' ? [] : (['proxy'] as const)),
    ];
    // a device with no way of its own is an iPhone; one that only counts is an Android
    const needs = usable.some((v) => REQUESTS.includes(v))
      ? undefined
      : device.network
        ? ANDROID_NEEDS
        : IPHONE_NEEDS;
    return { ways: usable, ...(proxy !== 'none' && { proxy }), ...(needs && { needs }) };
  };

  /** What the capture has seen so far, by the op an agent reads it with. */
  const read = async () => {
    const c = captures.read(serial);
    if (!c || reading) return;
    reading = true;
    try {
      const { answer: said, data } = await op({ action: 'read' });
      if (!data) {
        answer(said);
        return;
      }
      const entries = numbered(data);
      const note = c.via === 'packets' && !entries.length ? PACKETS_LATER : data.note;
      tell({ capturing: c.via, since: c.since, entries, ...(note ? { note } : {}) });
    } finally {
      reading = false;
    }
  };

  const look = async () => {
    clearInterval(looking);
    looking = undefined;
    const c = captures.read(serial);
    if (!c) {
      tell({ capturing: false, ...(await ways()) });
      return;
    }
    tell({ capturing: c.via, since: c.since });
    await read();
    if (c.via === 'probe' && wanted) looking = setInterval(() => void read(), PROBE_LOOK_MS);
  };

  const start = async (via: NetworkVia) => {
    if (via === 'probe' && (o.recording() || o.measuring())) {
      answer({ ok: false, text: PROBE_WHILE });
      return;
    }
    const front = await frontApp(device).catch(() => undefined);
    const app = front?.mine ? front.app : undefined;
    if (!app && via !== 'proxy') {
      answer({ ok: false, text: NO_APP });
      return;
    }
    answer({ line: via === 'probe' ? 'Restarting the app with the probe' : 'Starting' });
    const { answer: said } = await op({ action: 'start', via, ...(app && { app }) });
    // what the op says it sees is the pane's to say, in its own words
    answer(said.ok ? { ok: true, text: 'Capture started' } : said);
    if (said.ok) ours = true;
    await look();
  };

  const stop = async () => {
    const was = captures.read(serial);
    const { answer: said, data } = await op({ action: 'stop' });
    ours = false;
    if (!data) {
      answer(said);
      return;
    }
    answer({ ok: true, text: 'Capture stopped' });
    tell({
      capturing: false,
      ...(was && { was: was.via }),
      entries: numbered(data),
      ...(data.note ? { note: data.note } : {}),
      ...(await ways()),
    });
  };

  const controls: Record<string, (m: ViewerMessage) => Promise<unknown>> = {
    networkStart: (m) => start(String(m.via) as NetworkVia),
    networkStop: stop,
    networkRead: read,
  };

  return {
    /** The pane shows or hides, or a person pressed one of its buttons; false: the message is another's. */
    onWindow(m: ViewerMessage): boolean {
      const pressed = m.op === 'control' ? controls[String(m.name)] : undefined;
      if (pressed) {
        void pressed(m).catch((e: unknown) => answer({ ok: false, text: (e as Error).message }));
        return true;
      }
      if (m.op !== 'paneWatch' || m.pane !== 'network') return false;
      wanted = m.on === true;
      if (wanted)
        void look().catch((e: unknown) => answer({ ok: false, text: (e as Error).message }));
      else clearInterval(looking);
      return true;
    },

    /** The window closed: a capture it started ends with it, as a movie does. */
    async end() {
      wanted = false;
      clearInterval(looking);
      if (ours && captures.read(serial)) await op({ action: 'stop' }).catch(() => undefined);
    },
  };
}
