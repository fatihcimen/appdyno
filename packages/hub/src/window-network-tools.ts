import { mkdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stateDir, type Device, type NetworkDetail, type NetworkEntry } from '@appdyno/core';
import {
  captures,
  cleanHeaders,
  detailLines,
  redactLog,
  ruleLine,
  type Policy,
} from '@appdyno/ops';

export const NO_REQUEST = 'That request is no longer in the capture';
export const TOO_LONG =
  'Its answer is too long for a rule here. Save it to a file and use body=@file';
/** A rule's line holds this much: an answer past it goes in a file. */
const MAX_RULE = 4_000;

type Whole = { entry: NetworkEntry; detail: NetworkDetail | undefined };
type Called = { answer: { ok: boolean; text: string }; data: Record<string, unknown> | undefined };

/** A word of a shell, whatever it holds. */
const quoted = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/**
 * What a person does with one request in the Network pane beyond reading the list: see it whole, copy it as a command,
 * make a rule of its answer, and keep the capture as a file. All of it is read from the capture an agent reads.
 *
 * `real` is a person's choice in the window, held there and nowhere else: with it a request's headers and bodies are
 * shown and copied as they were sent. It reaches only this window. What an agent gets is the op's answer, which is
 * cleaned whatever a window shows; a rule made here is cleaned too, as an agent lists the rules.
 */
export function networkTools(
  device: Device,
  policy: Policy,
  tell: (m: Record<string, unknown>) => void,
  answer: (m: Record<string, unknown>) => void,
  op: (args: Record<string, unknown>) => Promise<Called>,
) {
  const clean = (text: string) => redactLog(policy, text);
  const as = (real: boolean) => (real ? (text: string) => text : clean);

  const whole = async (id: number): Promise<Whole | undefined> => {
    const handle = captures.read(device.serial)?.handle;
    if (!handle || !device.network) return undefined;
    const entry = (await device.network.read(handle)).entries.find((e) => e.id === id);
    return entry && { entry, detail: await device.network.detail?.(handle, id) };
  };
  /** Runs `then` on the request of that id, or says it is gone. */
  const withRequest = async (id: number, then: (w: Whole) => void) => {
    const w = await whole(id);
    if (w) then(w);
    else answer({ ok: false, text: NO_REQUEST });
  };

  return {
    /** One request whole, as the op's lines have it: cleaned, unless the person asked for what was sent. */
    detail: (id: number, real = false) =>
      withRequest(id, ({ entry, detail }) => {
        const show = as(real);
        const shown = { ...entry, ...(entry.url && { url: show(entry.url) }) };
        tell({ detail: { id, lines: detailLines(shown, detail, show) } });
      }),

    /** The request as a command that makes it again. */
    curl: (id: number, real = false) =>
      withRequest(id, ({ entry, detail }) => {
        const show = as(real);
        const headers = cleanHeaders(show, detail?.requestHeaders ?? {});
        tell({
          curl: [
            `curl -X ${entry.method ?? 'GET'} ${quoted(show(entry.url ?? ''))}`,
            ...headers.map((h) => `-H ${quoted(`${h.name}: ${h.value}`)}`),
            ...(detail?.requestBody === undefined
              ? []
              : [`--data-raw ${quoted(show(detail.requestBody))}`]),
          ].join(' '),
        });
      }),

    /** A rule that answers the request's address as the server did, as its line, for the person to set or change. */
    mockFrom: (id: number) =>
      withRequest(id, ({ entry, detail }) => {
        const url = new URL(entry.url ?? '');
        const type = Object.entries(detail?.responseHeaders ?? {}).find(([name]) =>
          /^content-type$/i.test(name),
        )?.[1];
        const line = [
          JSON.stringify(`${url.host}${url.pathname}`),
          ...(entry.method && entry.method !== 'GET' ? [`method=${entry.method}`] : []),
          `status=${entry.status ?? 200}`,
          ...(type ? [`type=${JSON.stringify(type)}`] : []),
          ...(detail?.responseBody === undefined
            ? []
            : [`body=${JSON.stringify(clean(detail.responseBody))}`]),
        ].join(' ');
        if (line.length > MAX_RULE) answer({ ok: false, text: TOO_LONG });
        else tell({ rule: ruleLine(line) });
      }),

    /** The capture as a HAR on the Desktop, by the op's own export: as clean as an agent's. */
    async save(stamp: string) {
      const name = `appdyno network ${stamp}.har`;
      const made = join(stateDir(), 'exports', name);
      const { answer: said, data } = await op({ action: 'read', save: made, overwrite: true });
      if (!data?.saved) {
        answer(said);
        return;
      }
      const file = join(homedir(), 'Desktop', name);
      mkdirSync(join(homedir(), 'Desktop'), { recursive: true });
      renameSync(made, file);
      answer({ ok: true, text: 'Saved to the Desktop', file });
    },
  };
}
