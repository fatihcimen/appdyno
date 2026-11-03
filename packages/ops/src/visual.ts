import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  decodePng,
  diffImages,
  encodePng,
  selectIn,
  statusBand,
  type Image,
  type PixelRect,
} from '@appdyno/core';
import { z } from 'zod';
import type { ServerContext } from './context.js';
import { VisualOut } from './schemas.js';
import { refused, type Session } from './session.js';
import { defineOp, READ, reply, ToolError, type Op } from './tool.js';

const DEFAULT_DIR = 'appdyno-baselines';
/** Percent of the pixels compared. */
const DEFAULT_TOLERANCE = 0.1;

const Mask = z
  .object({
    x: z.number().optional(),
    y: z.number().optional(),
    w: z.number().optional(),
    h: z.number().optional(),
    text: z.string().max(200).optional(),
    id: z.string().max(200).optional(),
    role: z.string().max(80).optional(),
  })
  .strict();

async function shot(s: Session): Promise<{ png: Buffer; image: Image }> {
  const { data } = await s.device.screenshot({ format: 'png', quality: 100 }).catch(refused);
  const image = decodePng(data);
  if (!image)
    throw new ToolError('the screenshot is a kind of PNG this tool cannot read', 'INTERNAL');
  return { png: data, image };
}

/** Screenshots against a saved image of the same screen, pixel by pixel. */
export function visualOps(ctx: ServerContext): Op[] {
  return [
    defineOp({
      name: 'visual',
      title: 'Visual comparison',
      description: `The screen against a saved image. action: baseline saves it as name under dir (default ./${DEFAULT_DIR}); compare refuses (CHECK_FAILED) past tolerance (percent of pixels, default ${DEFAULT_TOLERANCE}), with a diff image. masks: x,y,w,h or text, id, role; the status bar is left out.`,
      input: z
        .object({
          action: z.enum(['baseline', 'compare']),
          name: z.string().regex(/^[\w.-]{1,100}$/, 'letters, digits, dot, dash and underscore'),
          dir: z.string().max(1_000).optional(),
          tolerance: z.number().min(0).max(100).default(DEFAULT_TOLERANCE),
          masks: z.array(Mask).max(50).optional(),
        })
        .strict(),
      output: VisualOut,
      annotations: READ,
      run: async ({ action, name, dir, tolerance, masks }) => {
        const s = await ctx.session();
        const folder = resolve(dir ?? DEFAULT_DIR);
        const file = join(folder, `${name}.png`);
        const screen = await s.read();
        const { png, image } = await shot(s);
        if (action === 'baseline') {
          mkdirSync(folder, { recursive: true });
          writeFileSync(file, png);
          const t = `saved ${file} (${image.width}x${image.height})`;
          return reply(t, { done: t, file });
        }
        if (!existsSync(file))
          throw new ToolError(`no baseline ${file}: save one with action baseline`, 'NOT_FOUND');
        const baseline = decodePng(readFileSync(file));
        if (!baseline) throw new ToolError(`${file} is a kind of PNG this tool cannot read`);
        const units = screen.window?.w ?? s.device.hello?.screen.w ?? image.width;
        const k = image.width / units;
        const rect = (r: { x: number; y: number; width: number; height: number }): PixelRect => ({
          x: r.x * k,
          y: r.y * k,
          w: r.width * k,
          h: r.height * k,
        });
        const left = (masks ?? []).flatMap((m) => {
          if (m.text || m.id || m.role) {
            const hits = selectIn(screen.list, {
              ...(m.text && { text: m.text }),
              ...(m.id && { id: m.id }),
              ...(m.role && { role: m.role }),
            });
            if (hits.length === 0)
              throw new ToolError(
                `no element is ${m.text ?? m.id ?? m.role}, so nothing to mask`,
                'NOT_FOUND',
              );
            return hits.map((e) => rect(e.rect));
          }
          if (m.x === undefined || m.y === undefined || !m.w || !m.h)
            throw new ToolError('a mask is x, y, w and h, or text, id or role');
          return [rect({ x: m.x, y: m.y, width: m.w, height: m.h })];
        });
        const band = statusBand(screen.tree, s.device.platform, s.device.hello?.screen.density);
        const all = [
          ...left,
          ...(band > 0 ? [rect({ x: 0, y: 0, width: units, height: band })] : []),
        ];
        if (baseline.width !== image.width || baseline.height !== image.height)
          throw new ToolError(
            `the baseline is ${baseline.width}x${baseline.height}, the screen ${image.width}x${image.height}: not the same device or orientation`,
            'CHECK_FAILED',
          );
        const diff = diffImages(baseline, image, all);
        const diffFile = join(folder, `${name}.diff.png`);
        const actualFile = join(folder, `${name}.actual.png`);
        const percent = Math.round(diff.percent * 1000) / 1000;
        if (diff.percent <= tolerance) {
          rmSync(diffFile, { force: true });
          rmSync(actualFile, { force: true });
          const t = `the same as ${file}: ${percent} percent of pixels differ, tolerance ${tolerance}`;
          return reply(t, { done: t, file, percent, differing: diff.differing, same: true });
        }
        writeFileSync(diffFile, encodePng(diff.image));
        writeFileSync(actualFile, png);
        throw new ToolError(
          `${percent} percent of pixels differ from ${file}, tolerance ${tolerance}: diff ${diffFile}, now ${actualFile}`,
          'CHECK_FAILED',
          `open ${diffFile}: what differs is red, masks blue; if the change is meant, save it with action baseline`,
        );
      },
    }),
  ];
}
