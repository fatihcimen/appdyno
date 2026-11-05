import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { COMMANDS, usage } from './usage.js';

const USAGE = usage('mirror');

/** The words of `appdyno mirror`; `usage` when they make no call. */
export function mirrorArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: COMMANDS.mirror.flags,
  });
  const action = positionals[0] ?? 'open';
  const quality = values.quality ?? 'auto';
  const codec = values.codec;
  const wrong =
    !['open', 'close', 'status', 'stats'].includes(action) ||
    !['auto', 'high', 'standard'].includes(quality) ||
    (codec !== undefined && codec !== 'h264' && codec !== 'hevc') ||
    (values.pair === true && (values.device?.length !== 2 || values.detach === true));
  return {
    values,
    action,
    quality: quality as 'auto' | 'high' | 'standard',
    codec: codec as 'h264' | 'hevc' | undefined,
    usage: wrong ? USAGE : undefined,
  };
}

/** What a run of windows takes of these words. */
export function mirrorRun({ values, quality, codec }: ReturnType<typeof mirrorArgs>) {
  return {
    serials: values.device ?? [],
    all: values.all ?? false,
    watch: values.watch ?? false,
    max: Number(values.max ?? 8),
    options: { quality, ...(codec && { codec }), ...(values.wifi && { wifi: true }) },
    headless: values.headless ?? false,
    behind: values.behind ?? false,
    pair: values.pair ?? false,
    noInput: values['no-input'] ?? false,
    ...(values.seconds && { seconds: Number(values.seconds) }),
    ...(values.record && { record: resolve(values.record) }),
    focus: values.focus ?? false,
    inputOnClick: values['input-on-click'] ?? false,
    log: (line: string) => console.log(line),
  };
}

type Settings = { device?: string; 'allow-devices'?: string; takeover?: boolean };

/** `appdyno mirror`: stays with its windows until they close; its other words are the tool's. */
export async function mirrorCommand<Context extends { close(): void }>(
  args: string[],
  use: {
    context(settings: Settings): Context;
    tool(ctx: Context, words: string[]): Promise<number>;
    windows(ctx: Context, run: ReturnType<typeof mirrorRun>): Promise<number>;
  },
) {
  const words = mirrorArgs(args);
  const { values, action, quality, usage } = words;
  if (usage) {
    console.error(usage);
    return 2;
  }
  const ctx = use.context({
    ...(values.device?.[0] && { device: values.device[0] }),
    ...(values['allow-devices'] && { 'allow-devices': values['allow-devices'] }),
    ...(values.takeover && { takeover: true }),
  });
  try {
    return await (action !== 'open' || values.detach
      ? use.tool(ctx, [action, '--quality', quality, ...(values.wifi ? ['--wifi'] : [])])
      : use.windows(ctx, mirrorRun(words)));
  } finally {
    ctx.close();
  }
}

/** `appdyno hub`: stays with its window, and the windows it opens stay with their own processes. */
export async function hubCommand<Context extends { close(): void }>(
  args: string[],
  use: {
    context(settings: Settings): Context;
    hub(
      ctx: Context,
      run: { focus: boolean; behind: boolean; appearance?: string; log: (l: string) => void },
    ): Promise<number>;
  },
) {
  const { values } = parseArgs({ args, options: COMMANDS.hub.flags });
  const ctx = use.context({
    ...(values['allow-devices'] && { 'allow-devices': values['allow-devices'] }),
  });
  try {
    return await use.hub(ctx, {
      focus: values.focus ?? false,
      behind: values.behind ?? false,
      ...(values.appearance && { appearance: values.appearance }),
      log: (line) => console.log(line),
    });
  } finally {
    ctx.close();
  }
}
