import type {
  Device,
  NetworkPath,
  NetworkVia,
  ViewerControl,
  ViewerSaid,
  ViewerTold,
  WindowControl,
} from '@appdyno/core';
import { captures, ruleSwitched, type Policy } from '@appdyno/ops';
import { networkTools } from './window-network-tools.js';
import { frontApp, type WindowSession } from './controls.js';
import type { windowSends } from './window-sends.js';

type Call = ReturnType<typeof windowSends>['call'];

/** How often a probe's requests are read while the pane shows: it writes them to a file on this Mac. */
const PROBE_LOOK_MS = 3_000;
const MOST = 200;
/** The ways that list requests; the others count bytes. */
const REQUESTS: readonly NetworkVia[] = ['probe', 'proxy'];
export const IPHONE_NEEDS =
  "An iPhone's requests show only through an HTTP proxy you run, set in the iPhone's Wi-Fi settings, and then they show here. This window changes no setting on a phone.";
export const ANDROID_NEEDS =
  'Requests show only through an HTTP proxy you run, set on this device. This window changes no proxy: without one it counts what the app sends and receives.';
export const PROBE_WHILE =
  'The probe restarts the app: stop the recording first, or wait for the measure to end';
const NO_APP = 'Open an app of yours to capture its requests';
export const NO_PROBE = 'Start a capture by the probe first';
const PACKETS_LATER = 'Packets are counted when the capture stops';

/**
 * Each request with where it stands since the capture began, which the next read keeps as the oldest go: a window keeps
 * the one a person chose by it, where its place in the list moves. The probe numbers its own, and a request's headers
 * and bodies are asked for by that.
 */
const numbered = (data: Record<string, unknown>) =>
  ((data.entries as Record<string, unknown>[] | undefined) ?? []).map((e, i) => ({
    ...e,
    id: typeof e.id === 'number' ? e.id : Number(data.dropped ?? 0) + i,
  }));

/** What a device can see, read from it alone: listing them opens no session, and starts no agent. */
async function waysOf(device: Device) {
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
}

/**
 * A window's Network pane: the capture `network` keeps for the device, read by that op so an agent's and the pane's are
 * one, and the ways the device has. A proxy is offered only where the device already goes through one: no window sets one.
 */
export function windowNetwork(
  device: Device,
  policy: Policy,
  session: () => Pick<WindowSession, 'tell'>,
  call: Call,
  o: { recording(): boolean; measuring(): boolean },
) {
  const { serial } = device;
  let wanted = false;
  let ours = false;
  let reading = false;
  /** The last request a person cleared the list to: a read gives what came after it. */
  let cleared: number | undefined;
  let looking: NodeJS.Timeout | undefined;
  const tell = (m: ViewerTold<'network'>) => session().tell({ op: 'network', ...m });
  const answer = (m: Record<string, unknown>) =>
    session().tell({ op: 'answer', name: 'network', ...m });
  const op = (args: Record<string, unknown>) =>
    call('network', 'network', { ...args, limit: MOST });

  const ways = () => waysOf(device);

  /** The probe's rules with what each took, and its throttle, as the op an agent sets them by lists them. */
  const controlled = async () => {
    const { data } = await op({ action: 'mock' });
    return data
      ? {
          rules: (data.rules as unknown[] | undefined) ?? [],
          throttle: typeof data.throttle === 'string' ? data.throttle : 'full',
        }
      : {};
  };

  /** What the capture has seen so far, by the op an agent reads it with. */
  const read = async () => {
    const c = captures.read(serial);
    if (!c || reading) return;
    reading = true;
    try {
      const { answer: said, data } = await op({
        action: 'read',
        ...(cleared !== undefined && { after: cleared }),
      });
      if (!data) {
        answer(said);
        return;
      }
      const entries = numbered(data);
      const note = c.via === 'packets' && !entries.length ? PACKETS_LATER : data.note;
      tell({
        capturing: c.via,
        since: c.since,
        bodies: c.bodies === true,
        entries,
        ...(note ? { note } : {}),
        ...(c.via === 'probe' ? await controlled() : {}),
      });
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

  const start = async (via: NetworkVia, bodies = false) => {
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
    const { answer: said } = await op({
      action: 'start',
      via,
      ...(app && { app }),
      ...(bodies && via === 'probe' && { bodies }),
    });
    // what the op says it sees is the pane's to say, in its own words
    answer(said.ok ? { ok: true, text: 'Capture started' } : said);
    if (said.ok) ours = true;
    // a new capture numbers its requests from the start
    cleared = undefined;
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

  const tools = networkTools(device, policy, tell, answer, op);

  /** The list emptied for a person: what the capture holds stays, and a read gives what comes after. */
  const clear = async () => {
    const c = captures.read(serial);
    const all = c && (await device.network?.read(c.handle ?? {}).catch(() => undefined));
    cleared = all?.entries.at(-1)?.id ?? cleared;
    await read();
  };

  /** A change of the probe's rules or throttle, by the op an agent makes it with; then what holds now. */
  const change = async (args: Record<string, unknown>, done: string) => {
    // no capture: the op would start one, and restart the app under a person who asked for a rule
    if (captures.read(serial)?.via !== 'probe') {
      answer({ ok: false, text: NO_PROBE });
      return;
    }
    const { answer: said } = await op(args);
    answer(said.ok ? { ok: true, text: done } : said);
    await read();
  };
  const setRules = (rules: string[]) => change({ action: 'mock', rules }, 'Rules set');
  const switchRule = (at: number, on: boolean) =>
    setRules(
      (captures.read(serial)?.rules ?? []).map((line, i) =>
        i === at ? ruleSwitched(line, on) : line,
      ),
    );

  const controls = {
    networkStart: (m: ViewerControl<'networkStart'>) => start(m.via, m.bodies),
    networkStop: stop,
    networkRead: read,
    networkDetail: (m: ViewerControl<'networkDetail'>) => tools.detail(m.id, m.real),
    networkCurl: (m: ViewerControl<'networkCurl'>) => tools.curl(m.id, m.real),
    networkMockFrom: (m: ViewerControl<'networkMockFrom'>) => tools.mockFrom(m.id),
    networkSave: () => tools.save(new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')),
    networkClear: clear,
    networkRules: (m: ViewerControl<'networkRules'>) => setRules(m.rules),
    networkRuleSwitch: (m: ViewerControl<'networkRuleSwitch'>) => switchRule(m.at, m.on),
    networkThrottle: (m: ViewerControl<'networkThrottle'>) =>
      change({ action: 'throttle', throttle: m.value }, 'Speed set'),
  };

  return {
    /** The pane shows or hides, or a person pressed one of its buttons; false: the message is another's. */
    onWindow(m: WindowControl): boolean {
      if (m.op === 'control') {
        // each takes the control of its own name, which is the one it is found by
        const pressed = (
          controls as Record<string, (m: ViewerSaid<'control'>) => Promise<unknown>>
        )[m.name];
        if (!pressed) return false;
        void pressed(m).catch((e: unknown) => answer({ ok: false, text: (e as Error).message }));
        return true;
      }
      if (m.op !== 'paneWatch' || m.pane !== 'network') return false;
      wanted = m.on;
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
