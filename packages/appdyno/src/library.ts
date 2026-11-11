import {
  argumentsFor,
  DEFAULT_POLICY,
  flowsFor,
  opsFor,
  ServerContext,
  ToolError,
} from '@appdyno/ops';
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
};

/** What a tool answered: the words a person would read, its images, and its data. */
export type Answer<N extends ToolName> = {
  text: string;
  images: { data: string; mimeType: string }[];
  data: Tools[N]['data'];
};

/** What a refused call throws. `dispatched`: whether its touch went out, where it had one. */
export type Refusal = Error & { code: string; hint?: string; dispatched?: boolean | 'unknown' };

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

export type ReplayOptions = {
  /** The step to begin at, from 1. */
  from?: number;
  params?: Record<string, string>;
  /** Around each step's action, awaited. A throw ends the run with its error. */
  onStep?: (e: StepEvent) => void | Promise<void>;
  /** Where a failure leaves its screenshot and tree. */
  evidence?: string;
};

export type ReplayResult = {
  passed: boolean;
  steps: { n: number; step: string; ms: number; settledMs?: number }[];
  failure?: { n: number; step: string; message: string; code?: string; hint?: string };
};

export type Appdyno = {
  /** A tool of the MCP server, by its name. A refusal throws: see `Refusal`. */
  tool<N extends ToolName>(name: N, args: Tools[N]['args']): Promise<Answer<N>>;
  /** Runs a flow file on this device. */
  replay(file: string, options?: ReplayOptions): Promise<ReplayResult>;
  /** Puts back what it changed on the device, and lets it go. */
  close(): Promise<void>;
};

/** A device to drive from code: nothing is opened until the first call. */
export function connect(options: ConnectOptions = {}): Appdyno {
  const { device, app, allowDevices } = options;
  const ctx = new ServerContext(
    { ...DEFAULT_POLICY, ...(allowDevices && { devices: allowDevices }) },
    deviceProviders(),
    // the program that calls this is the person's own, as a command line is
    {
      ...(device && { device }),
      ...(app && { app }),
      claims: { share: false },
      tool: 'appdyno library',
      env: process.env,
    },
  );
  const ops = opsFor(ctx);
  const flows = flowsFor(ctx);
  return {
    async tool(name, args) {
      const op = ops[name];
      if (!op) throw new ToolError(`no tool ${name}`, 'INVALID_ARGUMENT');
      const { blocks, data } = await op.handler(argumentsFor(op, args));
      return {
        text: blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n'),
        images: blocks.flatMap((b) => (b.type === 'image' ? [b] : [])),
        data,
      };
    },
    replay: (file, o) => flows.replay(file, o),
    async close() {
      await ctx.end().catch(() => []);
      ctx.close();
    },
  };
}
