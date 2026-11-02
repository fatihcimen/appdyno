import { callSignal, throwIfCancelled } from '@appdyno/core';
import { execFile, spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { HitchSummary } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { xcodeEnv } from './simctl.js';

const run = promisify(execFile);

/** One cell of an exported trace table: its value and the tool's formatted text. */
export type Cell = { value: string; fmt?: string };

/**
 * The rows of a table that the trace tool exported as XML (`xctrace export --xpath`): column mnemonics
 * from the schema, each row's cells in column order; `ref` cells are resolved to the element with that id.
 */
export function parseTraceTable(xml: string): Record<string, Cell>[] {
  const cols = [...xml.matchAll(/<col><mnemonic>([^<]+)<\/mnemonic>/g)].map((m) => m[1]!);
  const ids = new Map<string, Cell>();
  const rows: Record<string, Cell>[] = [];
  for (const rowXml of xml.split('<row>').slice(1)) {
    const body = rowXml.slice(0, rowXml.indexOf('</row>'));
    // the row's top-level elements, in column order: <x id="1" fmt="…">value</x> or <x ref="1"/>
    const cells: Cell[] = [];
    let depth = 0;
    let start = -1;
    const tag = /<(\/?)([\w-]+)([^>]*?)(\/?)>/g;
    for (let m = tag.exec(body); m; m = tag.exec(body)) {
      const [whole, close, , , selfClose] = m;
      if (!close && depth === 0) start = m.index;
      if (!close && !selfClose) depth++;
      if (close) depth--;
      if (depth === 0 && start >= 0) {
        const el = body.slice(start, m.index + whole!.length);
        const ref = /^<[\w-]+[^>]*\bref="([^"]+)"/.exec(el)?.[1];
        const id = /^<[\w-]+[^>]*\bid="([^"]+)"/.exec(el)?.[1];
        const fmt = /^<[\w-]+[^>]*\bfmt="([^"]*)"/.exec(el)?.[1];
        let cell: Cell;
        if (ref) cell = ids.get(ref) ?? { value: '' };
        else {
          const inner = el.replace(/^<[^>]+>/, '').replace(/<\/[\w-]+>$/, '');
          cell = {
            value: /^[^<]*$/.test(inner) ? inner : (/>([^<]+)</.exec(inner)?.[1] ?? inner),
            ...(fmt !== undefined && { fmt }),
          };
          if (id) ids.set(id, cell);
        }
        // nested elements (a process's pid) carry ids too
        for (const n of el.matchAll(
          /<[\w-]+[^>]*\bid="([^"]+)"[^>]*\bfmt="([^"]*)"[^>]*>([^<]*)</g,
        ))
          if (!ids.has(n[1]!)) ids.set(n[1]!, { value: n[3]!, fmt: n[2]! });
        cells.push(cell);
        start = -1;
      }
    }
    rows.push(Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? { value: '' }])));
  }
  return rows;
}

export function hitchSummary(
  hitchesXml: string,
  surfacesXml: string,
  durationMs: number,
): HitchSummary {
  const hitches = parseTraceTable(hitchesXml).filter((r) => r['is-system']?.value !== '1');
  const ms = hitches.map((r) => Number(r.duration?.value ?? 0) / 1e6);
  const causes: Record<string, number> = {};
  for (const r of hitches) {
    const c = r['narrative-description']?.value || 'unknown';
    causes[c] = (causes[c] ?? 0) + 1;
  }
  const total = ms.reduce((a, b) => a + b, 0);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    durationMs,
    frames: parseTraceTable(surfacesXml).length,
    hitches: hitches.length,
    hitchMs: round(total),
    worstMs: round(Math.max(0, ...ms)),
    hitchRatio: round(total / (durationMs / 1000)),
    causes,
  };
}

/**
 * Animation hitches of a process on a phone or simulator: the trace tool records the Animation Hitches
 * template for `seconds` while `during` runs; the trace stays at `dir` for Instruments.
 */
export async function recordHitches(
  device: string,
  pid: number,
  seconds: number,
  dir: string,
  during?: () => Promise<unknown>,
): Promise<HitchSummary & { tracePath: string }> {
  await mkdir(dir, { recursive: true });
  const tracePath = join(dir, `hitches-${Date.now()}.trace`);
  const env = xcodeEnv();
  const rec = spawn(
    'xcrun',
    [
      'xctrace',
      'record',
      '--template',
      'Animation Hitches',
      '--device',
      device,
      '--attach',
      String(pid),
      '--time-limit',
      `${seconds}s`,
      '--output',
      tracePath,
      '--no-prompt',
    ],
    { env, ...(callSignal() && { signal: callSignal()! }) },
  );
  let log = '';
  rec.stdout.on('data', (b: Buffer) => (log += String(b)));
  rec.stderr.on('data', (b: Buffer) => (log += String(b)));
  const exited = new Promise<number | null>((r) => {
    rec.on('exit', r);
    rec.on('error', () => r(null));
  });
  // the recording starts a moment after the tool does
  await new Promise((r) => setTimeout(r, 2_000));
  if (during) await during();
  const code = await exited;
  throwIfCancelled('the recording');
  if (code !== 0)
    throw new DeviceError(
      'UNSUPPORTED',
      `the trace tool could not record: ${log.trim().split('\n').slice(-2).join(' ')}`,
    );
  const table = async (schema: string) =>
    (
      await run(
        'xcrun',
        [
          'xctrace',
          'export',
          '--input',
          tracePath,
          '--xpath',
          `/trace-toc/run[@number="1"]/data/table[@schema="${schema}"]`,
        ],
        {
          env,
          maxBuffer: 256 * 1024 * 1024,
        },
      )
    ).stdout;
  return {
    ...hitchSummary(
      await table('hitches'),
      await table('displayed-surfaces-interval'),
      seconds * 1000,
    ),
    tracePath,
  };
}
