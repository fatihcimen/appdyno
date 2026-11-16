import {
  argumentsFor,
  flowsFor,
  givenUp,
  inCall,
  opsFor,
  renamedHint,
  rawNodes,
  ServerContext,
  SHARE_BY_LIBRARY,
  ToolError,
} from '@appdyno/ops';
import { policyFor, signingOf } from './allow.js';
import { deviceProviders } from './providers.js';

/**
 * Each tool's arguments and what it answers, by its name. The build writes this out from the tools' own schemas:
 * what is published needs no other package's types, and zod's are not among them.
 */
export type Tools = Record<
  string,
  { args: Record<string, unknown>; data: Record<string, unknown> }
>;

// eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- the build puts an interface in Tools' place, whose keys are names
export type ToolName = keyof Tools & string;

export type ConnectOptions = {
  /** The device's serial; with none, the only one connected. */
  device?: string;
  /** The app the tools act on, where a call names none. */
  app?: string;
  /** Devices it may drive; with none, any. */
  allowDevices?: RegExp;
  /**
   * Links `open_link` opens with nothing asked, as `--allow-urls` gives a server, and the only ones it opens then. With
   * none, a web link and a scheme the selected app says it opens: any other is refused `PERMISSION_REQUIRED`, as a
   * program has no person to ask.
   */
  allowUrls?: RegExp;
  /** Drives a device another process holds, beside it, and holds it against none. `APPDYNO_SHARE=1` says so too. */
  share?: boolean;
  /**
   * Folders a tool may write in where a call names the path, beside the folder the program runs in and appdyno's own
   * state folder: a path anywhere else is refused, `POLICY_DENIED`. `APPDYNO_ALLOW_WRITE` lists more, as `PATH` does.
   */
  allowWrite?: string[];
  /**
   * `manage_app` `build_and_run` runs a project's own build scripts on this Mac, as `--allow-build` lets a server: without it
   * the call is refused `PERMISSION_REQUIRED`, as a program has no person to ask. Only a project inside the folders
   * above is built.
   */
  allowBuild?: boolean;
  /**
   * Texts never shown back in an answer, typed or put on the clipboard, as a test account's password. `APPDYNO_SECRETS`
   * (`a,b`) and the lines of the file `APPDYNO_SECRETS_FILE` names join them. Hidden in text alone: a screenshot and a
   * video show the screen as it was.
   */
  secrets?: string[];
  /** The same limits as one object, which `openDevice` takes too: see `Policy`. */
  policy?: Policy;
  /** An iPhone's signing for this device alone: see `Signing`. */
  signing?: Signing;
};

/**
 * What a program lets appdyno show and do, in one object that `connect` and `openDevice` both take. On `connect` each
 * field adds to the option of the same meaning: `secrets` to `secrets`, `write` to `allowWrite`, and `urls` stands in
 * place of `allowUrls`.
 */
export type Policy = {
  /** Texts never shown back, as a test account's password. Hidden in text alone, not in a picture. */
  secrets?: string[];
  /** The only apps that may be launched, stopped or cleared, and that a link may open in; with none, any. */
  apps?: string[];
  /** The only links that may be opened. */
  urls?: RegExp;
  /** Folders a file may be written in, beside the folder the program runs in and appdyno's own state folder. */
  write?: string[];
};

/**
 * What signs the runner for an iPhone: a development provisioning profile's path, and the keychain that holds its
 * identity, with its password where that keychain is locked. Given here it stands in place of `APPDYNO_IOS_PROFILE`,
 * `APPDYNO_IOS_KEYCHAIN` and `APPDYNO_IOS_KEYCHAIN_PASSWORD`, for this device alone. appdyno neither prints nor keeps
 * the password: read it from where secrets are kept, not from the source.
 */
export type Signing = { profile: string; keychain?: string; keychainPassword?: string };

/** What a tool answered: the words a person would read, its images, and its data. */
export type Answer<N extends ToolName> = {
  text: string;
  images: { data: string; mimeType: string }[];
  data: Tools[N]['data'];
  /** With `raw`, every element of the screen the call left: see `ScreenNode`. */
  nodes?: ScreenNode[];
};

/** One element of the screen's tree, as `read_screen` with `raw: true` gives it in `data.nodes`. */
export type ScreenNode = {
  /** What `tap_screen` takes: none on an element no touch reaches. */
  ref?: string;
  type: string;
  label?: string;
  text?: string;
  identifier?: string;
  placeholder?: string;
  rect?: { x: number; y: number; width: number; height: number };
  /** Its parent's index in the list; none for a root. */
  parent?: number;
  flags: string[];
};

/** Every code a refusal has. One may be added in a minor release: a program that takes each apart has a default. */
export type ErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'DEVICE_GONE'
  | 'AGENT_UNAVAILABLE'
  | 'AGENT_CONFLICT'
  | 'AGENT_VERSION_MISMATCH'
  | 'UNSUPPORTED'
  | 'PERMISSION_REQUIRED'
  | 'NOT_FOUND'
  | 'NO_FOCUS'
  | 'APP_NOT_RUNNING'
  | 'POLICY_DENIED'
  | 'INVALID_ARGUMENT'
  | 'STALE'
  | 'SCREEN_OFF'
  | 'INTERNAL'
  | 'AMBIGUOUS'
  | 'CHECK_FAILED'
  | 'BUILD_FAILED'
  | 'DEVICE_CLAIMED'
  | 'DEVICE_LOCKED'
  | 'OFFLINE';

/**
 * A run as a program reads it: one whose teardown failed has not passed, as `appdyno test` exits 1 for it, whatever
 * its own steps came to.
 */
const told = <R extends { passed: boolean; teardown?: { ok: boolean } }>(run: R) => {
  const teardownFailed = run.teardown?.ok === false;
  return {
    ...run,
    passed: run.passed && !teardownFailed,
    ...(teardownFailed && { teardownFailed }),
  };
};

/** What a refused call throws. `dispatched`: whether its touch went out, where it had one. */
export type Refusal = Error & { code: ErrorCode; hint?: string; dispatched?: boolean | 'unknown' };

/** One step of a replay, before its action and after the screen settled. */
export type StepEvent =
  | { phase: 'before'; n: number; total: number; step: { action: string; line: number } }
  | {
      phase: 'after';
      n: number;
      total: number;
      step: { action: string; line: number };
      /** `step`: its line of the file, never a value. `ms`: all of the step. */
      result: { step: string; ms: number; settledMs?: number };
    };

/** An `AbortSignal`, by what a call needs of it: these types stand without a library that declares one. */
export type StopSignal = {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
};

export type ReplayOptions = {
  /** The step to begin at, from 1. */
  from?: number;
  params?: Record<string, string>;
  /** Around each step's action, awaited. A throw ends the run with its error. */
  onStep?: (e: StepEvent) => void | Promise<void>;
  /** Where a failure leaves its screenshot and tree. */
  evidence?: string;
  /** Stops the run as it stops a call: `dispatched` is `true` once a step's action was done. */
  signal?: StopSignal;
};

/** What a call takes beside its arguments. */
export type CallOptions = {
  /**
   * Stops the call when it aborts: the call rejects with a `Refusal` whose `code` is `CANCELLED`. Its `dispatched` is
   * `false` where nothing of it had left for the device, and `'unknown'` once an action had: the screen says which.
   */
  signal?: StopSignal;
  /**
   * The answer also carries `nodes`, the tree of the screen the call left: the one an action's answer was read from,
   * with no second read, its words cleaned as the answer's are.
   */
  raw?: boolean;
};

/** A step of a replay that ran to its end. `skipped`: why it did not run, where it is another platform's. */
export type ReplayStep = {
  n: number;
  step: string;
  ms: number;
  settledMs?: number;
  skipped?: string;
};

/** A step that failed. `phase`: of the setup or of the teardown; none: of the flow's own steps. */
export type ReplayFailure = {
  n: number;
  step: string;
  message: string;
  code?: string;
  hint?: string;
  phase?: 'setup' | 'teardown';
};

export type ReplayResult = {
  /** The setup and the flow's own steps passed, and the teardown cleaned up: a run a next one can start after. */
  passed: boolean;
  /**
   * The teardown failed, so the next run starts from what it left. Where the flow's own steps passed, this is all
   * that keeps `passed` false, and `failure` is absent: `teardown.failed` says why.
   */
  teardownFailed?: true;
  /** The flow's own steps that ran to their end. */
  steps: ReplayStep[];
  /** The setup's, where the flow has one. */
  setup?: ReplayStep[];
  /** The first failure of the setup or of the flow's own steps, which ended them. */
  failure?: ReplayFailure;
  /** What the teardown did, where the flow has one: every step of it ran, and each that failed is here. */
  teardown?: { ok: boolean; steps: ReplayStep[]; failed: ReplayFailure[] };
};

export type Appdyno = {
  /** A tool of the MCP server, by its name. A refusal throws: see `Refusal`. */
  tool<N extends ToolName>(
    name: N,
    args: Tools[N]['args'],
    options?: CallOptions,
  ): Promise<Answer<N>>;
  /** Runs a flow file on this device. */
  replay(file: string, options?: ReplayOptions): Promise<ReplayResult>;
  /** Puts back what it changed on the device, and lets it go. */
  close(): Promise<void>;
};

/** `run` as a call that `signal` stops, the way a client's cancel stops a server's: one stopped before it began does nothing. */
function stoppedBy<T>(signal: StopSignal | undefined, what: string, run: () => Promise<T>) {
  if (!signal) return run();
  if (signal.aborted) return Promise.reject(givenUp(what));
  // the type asks for less than the signal a program has to give
  return inCall({ signal: signal as AbortSignal }, run);
}

/** A device to drive from code: nothing is opened until the first call. */
export function connect(options: ConnectOptions = {}): Appdyno {
  const { device, app, share = process.env.APPDYNO_SHARE === '1' } = options;
  const ctx = new ServerContext(
    policyFor(options),
    deviceProviders(false, undefined, undefined, {}, signingOf(options.signing)),
    // the program that calls this is the person's own, as a command line is
    {
      ...(device && { device }),
      ...(app && { app }),
      claims: { share, how: SHARE_BY_LIBRARY },
      tool: 'appdyno library',
      env: process.env,
    },
  );
  const ops = opsFor(ctx);
  const flows = flowsFor(ctx);
  return {
    async tool(name, args, { signal, raw } = {}) {
      const op = ops[name];
      if (!op) throw new ToolError(`no tool ${name}`, 'INVALID_ARGUMENT', renamedHint(name));
      const { blocks, data, nodes } = await stoppedBy(signal, name, async () => {
        const answer = await op.handler(argumentsFor(op, args));
        return { ...answer, ...(raw && { nodes: await rawNodes(ctx) }) };
      });
      return {
        text: blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        images: blocks.flatMap((b) => (b.type === 'image' ? [b] : [])),
        data,
        ...(nodes && { nodes }),
      };
    },
    async replay(file, { signal, ...o } = {}) {
      if (!signal) return told(await flows.replay(file, o));
      const seen = { before: 0, after: 0 };
      const stopped = () => {
        const refusal = givenUp(file);
        // a step that was done touched the screen, and one that had begun may have
        refusal.dispatched = seen.after > 0 || (seen.before > 0 && 'unknown');
        return refusal;
      };
      const run = await stoppedBy(signal, file, () =>
        flows.replay(file, {
          ...o,
          onStep: async (e) => {
            seen[e.phase]++;
            await o.onStep?.(e);
          },
        }),
      ).catch((e: unknown) => {
        throw signal.aborted && (e as Refusal).code === 'CANCELLED' ? stopped() : e;
      });
      // a step its signal stopped is no failure of the flow
      if (signal.aborted && run.failure?.code === 'CANCELLED') throw stopped();
      return told(run);
    },
    async close() {
      await ctx.end().catch(() => []);
      ctx.close();
    },
  };
}
