import { parseArgs } from 'node:util';

const USAGE = `usage: appdyno mirror [open] [--device S]... [--all [--watch]] [--max N] [--detach]
                      [--quality auto|high|standard] [--codec h264|hevc]
                      [--no-input] [--headless] [--seconds N] [--share] [--takeover] [--record file.mp4]
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
