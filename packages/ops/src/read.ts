import { motionText, takeStrip, watchScreen } from './watch.js';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  attributesOf,
  diffScreens,
  diffText,
  imageSize,
  safeName,
  screenStructure,
  selectIn,
  UNCHANGED,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers } from './answers.js';
import type { ServerContext } from './context.js';
import { FindOut, ScreenOut, ScreenshotOut, WaitOut } from './schemas.js';
import type { Session } from './session.js';
import { Read, Selector, WaitStep } from './step-schemas.js';
import type { Steps } from './steps.js';
import { defineOp, READ, reply, ToolError } from './tool.js';
import { webLines } from './web.js';

/** The fixtures' and Settings' smallest text still reads at this size and quality, and an answer costs half as much. */
const SHOT_PX = 800;
const SHOT_QUALITY = 60;
const MAX_SHOT_PX = 8_192;

/** The whole picture in a file: a folder gets a new name, and what is there stays unless asked. */
async function saveShot(s: Session, file: string, overwrite: boolean) {
  const given = resolve(file);
  const folder = existsSync(given) && statSync(given).isDirectory();
  const to = folder
    ? join(given, `${safeName(s.device.serial)}-${new Date().toISOString().replace(/\W/g, '')}.png`)
    : given;
  if (!/\.(png|jpe?g)$/i.test(to))
    throw new ToolError(`${to}: a .png, .jpg or .jpeg, or a folder`, 'INVALID_ARGUMENT');
  if (existsSync(to) && !overwrite)
    throw new ToolError(`${to} is there already`, 'INVALID_ARGUMENT', 'overwrite replaces it');
  const format = /\.png$/i.test(to) ? 'png' : 'jpeg';
  const own = await s.device.mirror.screenshot?.(format);
  const { data } = own ?? (await s.device.screenshot({ format, quality: 100 }));
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, data, { flag: overwrite ? 'w' : 'wx' });
  const size = imageSize(data);
  return reply(`saved ${to}${size ? ` (${size.w}x${size.h} px)` : ''}`, {
    width: size?.w ?? 0,
    height: size?.h ?? 0,
    warnings: [],
    file: to,
  });
}

export function readOps(
  ctx: ServerContext,
  { clean, noticed, header, show }: Answers,
  { waitFor }: Steps,
) {
  return [
    defineOp({
      name: 'screen',
      title: 'Read screen',
      description:
        'The elements on the screen (ref role "label" x,y flags; rows alike under one header, what a row holds left to find). A ref keeps naming its element when the screen changes.',
      input: z.object({}).strict(),
      output: ScreenOut,
      annotations: READ,
      run: async () => {
        const s = await ctx.session();
        const screen = await s.read();
        s.shown = screen.list;
        const fg = await noticed(s, screen);
        const web = await webLines(s, screen, clean);
        return reply(`${header(s, screen)}${web ? `\n${web}` : ''}${fg}`, {
          elements: screen.list.length,
          ...(screen.foreground && { foreground: screen.foreground }),
          warnings: fg ? [fg.trim()] : [],
        });
      },
    }),
    defineOp({
      name: 'find',
      title: 'Find',
      description:
        'Elements matching text, id or role, with enabled, checked, focused, value and bounds; no whole screen. For a pass or fail: assert.',
      input: Selector,
      output: FindOut,
      annotations: READ,
      run: async ({ index, ...sel }) => {
        if (!sel.text && !sel.id && !sel.role)
          throw new ToolError('give text, id or role', 'INVALID_ARGUMENT');
        const s = await ctx.session();
        const screen = await s.read();
        const all = selectIn(screen.list, sel);
        const hits = index === undefined ? all : all.slice(index, index + 1);
        const matches = hits.map((e) => {
          const { text: _whole, value, ...at } = attributesOf(screen.elements, e);
          return {
            ref: e.ref,
            role: e.role,
            label: clean(e.label),
            ...(e.id && { id: e.id }),
            x: e.x,
            y: e.y,
            ...at,
            ...(value !== undefined && { value: clean(value) }),
          };
        });
        if (hits.length === 0)
          return reply(`not found (${screen.list.length} elements)`, { matches });
        return reply(
          matches
            .map(
              (m) =>
                `${m.ref} ${m.role} ${JSON.stringify(m.label)} ${m.x},${m.y} ${m.bounds.w}x${m.bounds.h}` +
                `${m.enabled ? '' : ' disabled'}${m.checked ? ' checked' : ''}${m.focused ? ' focused' : ''}` +
                `${m.value !== undefined ? ` value=${JSON.stringify(m.value)}` : ''}`,
            )
            .join('\n'),
          { matches },
        );
      },
    }),
    defineOp({
      name: 'wait_for',
      title: 'Wait for',
      description: `Wait until an element shows (gone: until it is gone): text, id, role or ref. Use this instead of fixed sleeps.`,
      input: z.object({ ...WaitStep.omit({ action: true }).shape, read: Read }).strict(),
      output: WaitOut,
      annotations: READ,
      run: async ({ read, ...a }) => {
        const s = await ctx.session();
        const before = s.shown;
        const { screen: last, met, found } = await waitFor(s, a);
        const { gone, timeoutMs } = a;
        show(s, last);
        const head = met
          ? gone
            ? 'gone'
            : `found: ${found!.ref} ${JSON.stringify(clean(found!.label))}`
          : `${gone ? 'still there' : 'not shown'} after ${timeoutMs} ms`;
        const out = {
          met,
          gone,
          ...(found && !gone && { found: { ref: found.ref, label: clean(found.label) } }),
        };
        const diff =
          read === 'diff' && before
            ? diffText(diffScreens(before, last.list), last.list.length, clean)
            : undefined;
        const said = read === 'none' ? head : `${head}\n${diff ?? header(s, last)}`;
        if (!met) throw new ToolError(said, 'TIMEOUT');
        if (read === 'none') return reply(said, { ...out, screen: 'none' });
        return reply(said, {
          ...out,
          screen: diff === undefined ? 'full' : diff.startsWith(UNCHANGED) ? 'unchanged' : 'diff',
        });
      },
    }),
    defineOp({
      name: 'screenshot',
      title: 'Screenshot',
      description: `An image of the screen (at most ${SHOT_PX} px unless width) and the scale from its pixels to tap units; only for a visual judgement: the tree first, then watchMs (no image: what moved, way, speed, jumps; not intent), then a video. strip: 8 timed frames. A second of an unchanged screen is refused. points: 1 pixel is 1 tap unit. file: full size into a .png or .jpg, or a folder; overwrite replaces.`,
      input: z
        .object({
          points: z.boolean().optional(),
          width: z.number().int().min(64).max(8_192).optional(),
          watchMs: z.number().int().min(200).max(10_000).optional(),
          strip: z.boolean().optional(),
          file: z.string().max(1_000).optional(),
          overwrite: z.boolean().optional(),
        })
        .strict(),
      output: ScreenshotOut,
      annotations: READ,
      run: async ({ points, width, watchMs, strip, file, overwrite }) => {
        const s = await ctx.session();
        if (watchMs) {
          const m = await watchScreen(ctx, s, watchMs, strip === true);
          const shown = takeStrip(m);
          const text = motionText(m, s.device.hello!.screen);
          const at = shown
            ? `\nframes at ${shown.at.map((t) => (t / 1_000).toFixed(1)).join(', ')} s`
            : '';
          return reply(
            text + at,
            {
              width: 0,
              height: 0,
              warnings: [],
              motion: {
                frames: m.summary?.frames ?? 0,
                noisy: m.summary?.noisy ?? false,
                regions: m.summary?.regions.length ?? 0,
              },
            },
            shown ? [{ type: 'image', data: shown.data, mimeType: 'image/png' }] : [],
          );
        }
        if (file) return saveShot(s, file, overwrite === true);
        const layout = s.fresh
          ? `${!!points} ${width} ${screenStructure(s.fresh.list)}`
          : undefined;
        if (s.shot && s.shot.at === s.version && layout !== undefined && s.shot.hash === layout)
          throw new ToolError(
            'the screen has not changed since the last image: that image still holds',
            'INVALID_ARGUMENT',
          );
        const size = s.device.hello?.screen;
        const wide = width ?? (points ? size?.w : undefined);
        const { meta, data } = await s.device.screenshot({
          format: 'jpeg',
          quality: SHOT_QUALITY,
          // a device's limit is on the long side
          maxPx: wide
            ? Math.min(
                MAX_SHOT_PX,
                size ? Math.round((wide * Math.max(size.w, size.h)) / size.w) : wide,
              )
            : SHOT_PX,
        });
        const look = await s.current().catch(() => undefined);
        const fg = look ? await noticed(s, look) : '';
        const w = s.device.hello?.screen.w;
        s.shot = { at: s.version, hash: layout ?? '' };
        const scale = w ? Math.round((w / meta.w) * 1000) / 1000 : undefined;
        return reply(
          `image ${meta.w}x${meta.h} px${scale ? `; tap unit = pixel × ${scale.toFixed(3)}` : ''}${fg}`,
          {
            width: meta.w,
            height: meta.h,
            ...(scale && { scale }),
            warnings: fg ? [fg.trim()] : [],
          },
          [{ type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' }],
        );
      },
    }),
  ];
}
