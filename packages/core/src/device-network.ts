export type NetworkVia = 'proxy' | 'probe' | 'packets' | 'bytes';

/** One way of seeing traffic on this device: what it sees, or why it cannot. */
export type NetworkPath = { via: NetworkVia; sees?: string; refused?: string };

/** A request, or a count, whichever the way sees. */
export type NetworkEntry = {
  at?: string;
  method?: string;
  url?: string;
  status?: number;
  ms?: number;
  /** A count: which way, and what it was counted against (a port, a uid). */
  direction?: string;
  host?: string;
  packets?: number;
  bytes?: number;
  /** The export holds its response body. */
  body?: boolean;
  error?: string;
  /** The transport's own number for `error`, as the system has it: -999 is a request the app gave up. */
  code?: number;
  /** Its place in the capture, by which its headers and bodies are asked for where the capture keeps them. */
  id?: number;
  /**
   * What a rule did to it: `mocked`, `failed`, `delayed`, `sent` to another host; `lost` by the throttle; `unmatched`:
   * failed as no rule took it.
   */
  how?: string;
  /** The rule that took it. */
  rule?: string;
  to?: string;
  /** It has started and not ended: `ms` is how long ago. */
  inFlight?: boolean;
  timings?: NetworkTimings;
};

/**
 * What the session that sent a request measured of it: each phase in milliseconds, -1 where it had none, as a
 * connection that was there already has no connect; whether the answer came from the cache; the body's bytes as they
 * came. The connection and the protocol are those of the session it went through, which under a probe is the probe's.
 */
export type NetworkTimings = {
  dns: number;
  connect: number;
  tls: number;
  wait: number;
  receive: number;
  reused: boolean;
  cache: boolean;
  wire: number;
  proto?: string;
  ip?: string;
};

/** A rule as the probe reads it: what it takes, by patterns over the whole host and path, and what it does. */
export type NetworkRule = {
  /** By which a request in the capture names it. */
  id: string;
  off?: true;
  method?: string;
  host?: string;
  path?: string;
  query?: [string, string][];
  /** What the request's body holds, each: a text of it, and where it is JSON the value at a path. */
  has?: { text: string; path?: (string | number)[]; equals?: string }[];
  /** Headers of the request, each by its name with a pattern over its whole value. */
  when?: { name: string; value: string }[];
  /** Its own answer, and none from the network. */
  status?: number;
  headers?: Record<string, string>;
  body?: string;
  bodyFile?: string;
  delayMs?: number;
  fail?: 'offline' | 'timeout' | 'reset';
  to?: { scheme?: string; host: string; port?: number };
  times?: number;
};

/** A slow network: a wait before each request, bytes a second each way (0: no limit), the percent of requests lost. */
export type NetworkThrottle = { delayMs: [number, number]; down: number; up: number; loss: number };

/** What a capture does beside listing requests. */
export type NetworkControl = {
  bodies: boolean;
  rules: NetworkRule[];
  throttle?: NetworkThrottle;
  /** A request no rule takes fails, as with no network: a run in which nothing leaves the device unseen. */
  unmatched?: 'fail';
};

/** A request's headers and bodies as they were kept: a body's text where it is one, to the cap. */
export type NetworkDetail = {
  requestHeaders: Record<string, string>;
  responseHeaders: Record<string, string>;
  requestBody?: string;
  requestBodySize?: number;
  responseBody?: string;
  responseBodySize?: number;
  note?: string;
};

/** What the app made that this way cannot see, each kind with how many: `webview`, `background`, `websocket`. */
export type NetworkUnseen = Record<string, number>;

export type NetworkAnswer = { entries: NetworkEntry[]; note?: string; unseen?: NetworkUnseen };

/** What later calls need: plain values, as they may be other processes. */
export type NetworkHandle = Record<string, string | number>;

/** The traffic a device can tell about by itself; a local proxy is the operations' own, through settings. */
export type NetworkSource = {
  paths(): Promise<NetworkPath[]>;
  start(via: NetworkVia, app: string | undefined, bodies?: boolean): Promise<NetworkHandle>;
  /** `bare`: the requests alone, with nothing asked of the device for a note. */
  read(handle: NetworkHandle, bare?: boolean): Promise<NetworkAnswer>;
  stop(handle: NetworkHandle): Promise<NetworkAnswer>;
  /** When the capture ended by itself, at a limit of its own, on this Mac's clock, 0 at no time it can say; none while it runs. */
  endedAt?(handle: NetworkHandle): Promise<number | undefined>;
  /** What the capture does from now on, whole; only a way that is in the app takes it. */
  control?(handle: NetworkHandle, control: NetworkControl): void;
  /** One request's headers and bodies, where the capture keeps them. */
  detail?(handle: NetworkHandle, id: number): Promise<NetworkDetail | undefined>;
};

export type WebPage = { id: string; title: string; url: string; app?: string; visible?: boolean };

/** The web views of debuggable apps, as DevTools or the Safari inspector shows them. */
export type WebInspector = {
  pages(app: string | undefined): Promise<WebPage[]>;
  /** Runs a script on the page, its value back; a thrown error is a refusal with its text. */
  evaluate(page: WebPage, script: string): Promise<unknown>;
};
