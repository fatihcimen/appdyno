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
};

export type NetworkAnswer = { entries: NetworkEntry[]; note?: string };

/** What later calls need: plain values, as they may be other processes. */
export type NetworkHandle = Record<string, string | number>;

/** The traffic a device can tell about by itself; a local proxy is the operations' own, through settings. */
export type NetworkSource = {
  paths(): Promise<NetworkPath[]>;
  start(via: NetworkVia, app: string | undefined): Promise<NetworkHandle>;
  read(handle: NetworkHandle): Promise<NetworkAnswer>;
  stop(handle: NetworkHandle): Promise<NetworkAnswer>;
};

export type WebPage = { id: string; title: string; url: string; app?: string; visible?: boolean };

/** The web views of debuggable apps, as DevTools or the Safari inspector shows them. */
export type WebInspector = {
  pages(app: string | undefined): Promise<WebPage[]>;
  /** Runs a script on the page, its value back; a thrown error is a refusal with its text. */
  evaluate(page: WebPage, script: string): Promise<unknown>;
};
