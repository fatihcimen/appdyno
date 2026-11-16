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
  /** Its place in the capture, by which its headers and bodies are asked for where the capture keeps them. */
  id?: number;
  /** What a rule did to it: `mocked`, `failed`, `delayed`, `sent` to another host; `lost` by the throttle. */
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
export type NetworkControl = { bodies: boolean; rules: NetworkRule[]; throttle?: NetworkThrottle };

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

export type NetworkAnswer = { entries: NetworkEntry[]; note?: string };

/** What later calls need: plain values, as they may be other processes. */
export type NetworkHandle = Record<string, string | number>;

/** The traffic a device can tell about by itself; a local proxy is the operations' own, through settings. */
export type NetworkSource = {
  paths(): Promise<NetworkPath[]>;
  start(via: NetworkVia, app: string | undefined, bodies?: boolean): Promise<NetworkHandle>;
  read(handle: NetworkHandle): Promise<NetworkAnswer>;
  stop(handle: NetworkHandle): Promise<NetworkAnswer>;
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
