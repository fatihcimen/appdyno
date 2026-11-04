import { resolve } from 'node:path';
import { parseArgs } from 'node:util';

const USAGE = `usage: appdyno mirror [open] [--device S]... [--all [--watch]] [--max N] [--detach]
                      [--quality auto|high|standard] [--codec h264|hevc]
                      [--no-input] [--headless] [--seconds N] [--share] [--takeover] [--record file.mp4] [--focus]
       appdyno mirror close|status|stats`;

/** The words of `appdyno mirror`; `usage` when they make no call, `help` when it was asked for. */
export function mirrorArgs(args: string[]) {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      device: { type: 'string', multiple: true },
      all: { type: 'boolean' },
      watch: { type: 'boolean' },
      max: { type: 'string' },
      detach: { type: 'boolean' },
      quality: { type: 'string' },
      codec: { type: 'string' },
      'no-input': { type: 'boolean' },
      headless: { type: 'boolean' },
      seconds: { type: 'string' },
      share: { type: 'boolean' },
      takeover: { type: 'boolean' },
      record: { type: 'string' },
      focus: { type: 'boolean' },
      'input-on-click': { type: 'boolean' },
      'allow-devices': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const action = positionals[0] ?? 'open';
  const quality = values.quality ?? 'auto';
  const codec = values.codec;
  const wrong =
    !['open', 'close', 'status', 'stats'].includes(action) ||
    !['auto', 'high', 'standard'].includes(quality) ||
    (codec !== undefined && codec !== 'h264' && codec !== 'hevc');
  return {
    values,
    action,
    quality: quality as 'auto' | 'high' | 'standard',
    codec: codec as 'h264' | 'hevc' | undefined,
    help: values.help ? USAGE : undefined,
    usage: wrong && !values.help ? USAGE : undefined,
  };
}

/** What a run of windows takes of these words. */
export function mirrorRun({ values, quality, codec }: ReturnType<typeof mirrorArgs>) {
  return {
    serials: values.device ?? [],
    all: values.all ?? false,
    watch: values.watch ?? false,
    max: Number(values.max ?? 8),
    options: { quality, ...(codec && { codec }) },
    headless: values.headless ?? false,
    noInput: values['no-input'] ?? false,
    ...(values.seconds && { seconds: Number(values.seconds) }),
    ...(values.record && { record: resolve(values.record) }),
    share: values.share ?? false,
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
  const { values, action, quality, help, usage } = words;
  if (help) console.log(help);
  if (usage) console.error(usage);
  if (help || usage) return help ? 0 : 2;
  const ctx = use.context({
    ...(values.device?.[0] && { device: values.device[0] }),
    ...(values['allow-devices'] && { 'allow-devices': values['allow-devices'] }),
    ...(values.takeover && { takeover: true }),
  });
  try {
    return await (action !== 'open' || values.detach
      ? use.tool(ctx, [action, '--quality', quality])
      : use.windows(ctx, mirrorRun(words)));
  } finally {
    ctx.close();
  }
}
