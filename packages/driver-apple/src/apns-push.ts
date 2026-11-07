import {
  PUSH_PLACEHOLDERS,
  PushRate,
  type Push,
  type PushField,
  type PushRoute,
  type PushTokenKind,
  type PushType,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { apnsKey, type ApnsKey } from './apns-key.js';
import { apnsPayload, LIVE_ACTIVITY_TEMPLATE } from './apns-payload.js';
import {
  APNS_HINTS,
  apnsRequest,
  providerToken,
  sendApns,
  type ApnsAnswer,
  type ApnsEnvironment,
  type ApnsKind,
  type ApnsRequest,
} from './apns.js';

/** What a device lets APNs know of an app there, and where the app's own lines are read. */
export type ApnsTarget = {
  /** For the answers: simulator, iPhone. */
  readonly name: string;
  /** A simulator takes only the sandbox's pushes. */
  readonly production: boolean;
  installed(app: string): Promise<boolean>;
  /** The app's own lines in this session, and whether it was relaunched for them. */
  lines(app: string, wanted: PushTokenKind): Promise<{ lines: string[]; relaunched?: boolean }>;
  /** The app's build, where its signing can be read here. */
  build(app: string): Promise<'development' | 'distribution' | undefined>;
  /** Whether the app declares VoIP, where its Info.plist can be read here. */
  declaresVoip(app: string): Promise<boolean | undefined>;
  /** The system's major version. */
  osMajor(): Promise<number>;
};

/** What a push of each type is to APNs: its kind, the token it goes by, the fields it takes. */
const BY_TYPE: Partial<
  Record<PushType, { kind: ApnsKind; token: PushTokenKind; fields: PushField[] }>
> = {
  alert: { kind: 'alert', token: 'device', fields: ['title', 'body', 'data'] },
  rich: { kind: 'alert', token: 'device', fields: ['title', 'body', 'image', 'data'] },
  background: { kind: 'background', token: 'device', fields: ['data'] },
  live_activity: { kind: 'liveactivity', token: 'activity', fields: [] },
  voip: { kind: 'voip', token: 'voip', fields: ['data'] },
  widgets: { kind: 'widgets', token: 'widget', fields: [] },
};

/** A token as an app prints it: hex, 32 bytes or more. */
const HEX = /\b[0-9a-f]{64,}\b/gi;

/** The words of an app's line that say which token it prints; any other is taken for the device's. */
const kindOf = (line: string): PushTokenKind =>
  /push.?to.?start/i.test(line)
    ? 'start'
    : /activity/i.test(line)
      ? 'activity'
      : /voip|pushkit/i.test(line)
        ? 'voip'
        : /widget/i.test(line)
          ? 'widget'
          : 'device';

/** Every token in an app's lines, by the words of its line, oldest first. */
export const tokensIn = (lines: string[]) =>
  lines.flatMap((line) =>
    [...line.matchAll(HEX)].map((m) => ({ token: m[0].toLowerCase(), kind: kindOf(line) })),
  );

const HOW_A_TOKEN_IS_FOUND =
  'the app prints it in its own log, by NSLog or os_log, in a line that names a push to start, an activity, VoIP or a widget for those tokens, any other for the device token; or a person types it in the window';

/** Apple's reasons that say a token is no good: it is dropped, and the next push reads the app's log again. */
const SPENT = /^(BadDeviceToken|DeviceTokenNotForTopic|ExpiredToken|Unregistered)$/;

const clock = (ms: number) => new Date(ms).toTimeString().slice(0, 8);

/** A token this tool read, never shown: from whom, and when. */
type Kept = { token: string; kind: PushTokenKind; from: 'log' | 'person'; at: number };

/**
 * Pushes by APNs to an app on one device, behind what a person set up: Apple's hosts alone, a token this tool read from
 * the app's own log in this session or a person typed, the app installed there, the environment its build is for, the
 * payload's limit, and 10 a minute.
 */
export class ApnsPush {
  private readonly kept = new Map<string, Kept[]>();
  private readonly rate = new PushRate();

  constructor(
    private readonly target: ApnsTarget,
    private readonly use: {
      key: () => ApnsKey | undefined;
      send: (environment: ApnsEnvironment, request: ApnsRequest) => Promise<ApnsAnswer>;
      now: () => number;
    } = { key: apnsKey, send: (e, r) => sendApns(e, r), now: Date.now },
  ) {}

  /** Whether a person set APNs up on this Mac: all an MCP client may know of it. */
  get ready() {
    return this.use.key() !== undefined;
  }

  /** The route of each type APNs takes here, once it is set up. */
  routes(): PushRoute[] {
    if (!this.ready) return [];
    const host = this.target.production
      ? 'APNs, its sandbox, or production for a distribution build'
      : "APNs' sandbox";
    return Object.entries(BY_TYPE).map(([type, t]) => ({
      type: type as PushType,
      route: `${host}, by the ${t.token} token the app printed in this session or a person typed${t.kind === 'liveactivity' ? ': event start, update or end, by push to start for start' : ''}`,
      fields: t.fields,
      template: JSON.stringify(
        t.kind === 'liveactivity'
          ? LIVE_ACTIVITY_TEMPLATE
          : apnsPayload({ ...PUSH_PLACEHOLDERS, type: type as PushType }),
      ),
    }));
  }

  /** A person's token, typed in a window: never an MCP client's. */
  typed(app: string, token: string, kind: PushTokenKind = 'device') {
    if (!/^[0-9a-f]{64,}$/i.test(token))
      throw new DeviceError('INVALID_ARGUMENT', 'a token is hex, 64 characters or more');
    this.keep(app, [{ token: token.toLowerCase(), kind, from: 'person', at: this.use.now() }]);
  }

  async push(app: string, push: Push): Promise<string> {
    const key = this.use.key();
    const t = BY_TYPE[push.type];
    if (!key || !t) throw new DeviceError('UNSUPPORTED', `APNs takes no ${push.type} push here`);
    if (!(await this.target.installed(app)))
      throw new DeviceError('NOT_FOUND', `${app} is not installed on this ${this.target.name}`);
    await this.allowed(app, push.type);
    const payload = apnsPayload(push, this.use.now());
    const environment = await this.environment(app, key);
    const starts = push.type === 'live_activity' && (payload.aps as { event?: unknown }).event;
    const wanted = starts === 'start' ? 'start' : t.token;
    const now = this.use.now();
    this.rate.check(now);
    const { token, relaunched } = await this.token(app, wanted);
    const request = apnsRequest(t.kind, app, token.token, payload, providerToken(key, now));
    this.rate.went(now);
    const a = await this.use.send(environment, request);
    const by = `by the ${wanted} token ${token.from === 'person' ? 'a person typed' : 'its log gave'} at ${clock(token.at)}`;
    const lost = relaunched ? `; ${app} was relaunched to read it, and lost its state` : '';
    if (a.status === 200)
      return `pushed to ${app} by APNs' ${environment} ${by}${lost}: APNs took it${a.apnsId ? `, ${a.apnsId}` : ''}`;
    if (a.reason && SPENT.test(a.reason))
      this.kept.set(
        app,
        (this.kept.get(app) ?? []).filter((k) => k !== token),
      );
    throw new DeviceError(
      'UNSUPPORTED',
      `APNs' ${environment} refused the push ${by}${lost}: ${a.reason ?? 'no reason'} (${a.status})`,
      APNS_HINTS[a.reason ?? ''] ?? `Apple's "Handling notification responses from APNs" says why`,
    );
  }

  /** VoIP for an app known to declare it, a widget's push from iOS 26. */
  private async allowed(app: string, type: PushType) {
    if (type === 'voip' && (await this.target.declaresVoip(app)) !== true)
      throw new DeviceError(
        'UNSUPPORTED',
        `${app} is not known to declare VoIP, by UIBackgroundModes voip, which a VoIP push needs`,
      );
    if (type === 'widgets' && (await this.target.osMajor()) < 26)
      throw new DeviceError('UNSUPPORTED', 'a widget takes pushes from iOS 26');
  }

  /**
   * The sandbox, but for an app known to be a distribution build on an iPhone, with production on: never guessed, and
   * a push refused on one host never goes to the other. A sandbox push reaches no production build.
   */
  private async environment(app: string, key: ApnsKey): Promise<ApnsEnvironment> {
    if (!this.target.production || (await this.target.build(app)) !== 'distribution')
      return 'sandbox';
    if (!key.production)
      throw new DeviceError(
        'UNSUPPORTED',
        `${app} is a distribution build, which takes pushes from production, and production is off`,
        'a person turns it on with `appdyno push setup apns`',
      );
    return 'production';
  }

  /** The app's newest token of this kind: kept, else read from its own lines now. */
  private async token(app: string, kind: PushTokenKind) {
    const newest = () => (this.kept.get(app) ?? []).filter((k) => k.kind === kind).at(-1);
    const kept = newest();
    if (kept) return { token: kept };
    const read = await this.target.lines(app, kind);
    const at = this.use.now();
    this.keep(
      app,
      tokensIn(read.lines).map((t) => ({ ...t, from: 'log' as const, at })),
    );
    const found = newest();
    const again = read.relaunched
      ? ', though it was relaunched to read one, and lost its state'
      : '';
    if (!found)
      throw new DeviceError(
        'NOT_FOUND',
        `no ${kind} token from ${app} in this session${again}`,
        HOW_A_TOKEN_IS_FOUND,
      );
    return { token: found, ...(read.relaunched && { relaunched: true }) };
  }

  private keep(app: string, more: Kept[]) {
    if (more.length > 0) this.kept.set(app, [...(this.kept.get(app) ?? []), ...more]);
  }
}
