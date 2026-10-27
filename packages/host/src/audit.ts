import { inflateSync } from 'node:zlib';
import type { AuditIssue, AuditResult, AuditType, TextClip, Tree } from '@appdyno/protocol';
import { elementsOf, type UiElement } from './screen/elements.js';

/**
 * Android's accessibility checks, computed on the host from the agent's tree, a screenshot and the
 * characters each text node does not show (`a11y.read`). iOS has the platform's own audit (the runner's
 * `audit`); these checks are named after its types where they check the same thing.
 */

/** A decoded screenshot: 8-bit RGB or RGBA rows, top to bottom. */
export type Image = { width: number; height: number; channels: 3 | 4; data: Uint8Array };

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * The agent's PNG screenshots as pixels (zlib and the five row filters, no dependency).
 * shortcut: 8-bit RGB/RGBA, non-interlaced only (what the agent's encoder writes); anything else is null
 * and the screen gets no colour checks
 */
export function decodePng(buf: Buffer): Image | null {
  try {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(PNG)) return null;
    let p = 8;
    let width = 0;
    let height = 0;
    let c: 3 | 4 | undefined;
    const idat: Buffer[] = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p);
      const type = buf.toString('latin1', p + 4, p + 8);
      const data = buf.subarray(p + 8, p + 8 + len);
      if (type === 'IHDR') {
        width = data.readUInt32BE(0);
        height = data.readUInt32BE(4);
        const [depth, color, , , interlace] = data.subarray(8, 13);
        if (depth !== 8 || interlace !== 0 || (color !== 2 && color !== 6)) return null;
        c = color === 6 ? 4 : 3;
      } else if (type === 'IDAT') idat.push(data);
      else if (type === 'IEND') break;
      p += 12 + len;
    }
    if (!c || width === 0 || height === 0 || width * height > 16e6) return null;
    const stride = width * c;
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: height * (stride + 1) });
    if (raw.length < height * (stride + 1)) return null;
    const out = new Uint8Array(height * stride);
    const left = (dst: number, x: number) => (x >= c ? out[dst + x - c]! : 0);
    for (let y = 0; y < height; y++) {
      const f = raw[y * (stride + 1)];
      const src = y * (stride + 1) + 1;
      const dst = y * stride;
      const up = (x: number) => (y > 0 ? out[dst - stride + x]! : 0);
      // one loop per filter type: a branch per byte would double the decode time
      if (f === 0) out.set(raw.subarray(src, src + stride), dst);
      else if (f === 1)
        for (let x = 0; x < stride; x++) out[dst + x] = raw[src + x]! + left(dst, x);
      else if (f === 2) for (let x = 0; x < stride; x++) out[dst + x] = raw[src + x]! + up(x);
      else if (f === 3)
        for (let x = 0; x < stride; x++)
          out[dst + x] = raw[src + x]! + ((left(dst, x) + up(x)) >> 1);
      else if (f === 4)
        for (let x = 0; x < stride; x++) {
          const a = left(dst, x);
          const b = up(x);
          const d = x >= c && y > 0 ? out[dst - stride + x - c]! : 0;
          const q = a + b - d;
          const [pa, pb, pc] = [Math.abs(q - a), Math.abs(q - b), Math.abs(q - d)];
          out[dst + x] = raw[src + x]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : d);
        }
      else return null;
    }
    return { width, height, channels: c, data: out };
  } catch {
    return null;
  }
}

type Rgb = [number, number, number];
/** WCAG relative luminance and contrast ratio. */
const lum = ([r, g, b]: Rgb) => {
  const lin = (v: number) =>
    v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
export const contrastRatio = (a: Rgb, b: Rgb) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const hex = (c: Rgb) =>
  `#${c
    .map((v) => Math.round(v).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;

/**
 * The colours of a rect (image pixels): the dominant one (the background, its share), the far end of
 * the others from it (the glyph or icon core; anti-aliasing blends sit between) and how many are
 * common. 5-bit bins per channel: a solid colour stays in one.
 */
export function sample(img: Image, r: { x: number; y: number; w: number; h: number }) {
  const x0 = Math.max(0, Math.round(r.x));
  const y0 = Math.max(0, Math.round(r.y));
  const x1 = Math.min(img.width, Math.round(r.x + r.w));
  const y1 = Math.min(img.height, Math.round(r.y + r.h));
  if (x1 - x0 < 4 || y1 - y0 < 4) return null;
  const step = Math.max(1, Math.ceil(Math.sqrt(((x1 - x0) * (y1 - y0)) / 40_000)));
  const bins = new Map<number, { n: number; s: Rgb }>();
  let total = 0;
  for (let y = y0; y < y1; y += step)
    for (let x = x0; x < x1; x += step) {
      const i = (y * img.width + x) * img.channels;
      const px: Rgb = [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!];
      const k = ((px[0] >> 3) << 10) | ((px[1] >> 3) << 5) | (px[2] >> 3);
      const b = bins.get(k) ?? { n: 0, s: [0, 0, 0] };
      b.n++;
      b.s[0] += px[0];
      b.s[1] += px[1];
      b.s[2] += px[2];
      bins.set(k, b);
      total++;
    }
  const list = [...bins.values()]
    .map((b) => ({ share: b.n / total, rgb: b.s.map((v) => v / b.n) as Rgb }))
    .sort((a, b) => b.share - a.share);
  const bg = list[0]!;
  const dist = (a: Rgb, b: Rgb) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const fg = list
    .filter((b) => b.share >= 0.005 && dist(b.rgb, bg.rgb) > 30)
    .sort((a, b) => dist(b.rgb, bg.rgb) - dist(a.rgb, bg.rgb))[0];
  return { bg, fg, colours: list.filter((b) => b.share >= 0.01).length };
}

/** Material's minimum touch target (dp). */
const TARGET_DP = 48;
/** WCAG 1.4.3: 4.5:1, large text 3:1 (a frame this many dp tall); 1.4.11 non-text 3:1. */
const TEXT_MIN = 4.5;
const LARGE_MIN = 3;
const LARGE_TEXT_DP = 28;
/** A clean sample: its background covers this share and few colours are common (no photo). */
const CLEAN_TEXT = 0.5;
const CLEAN_ICON = 0.4;
const MAX_COMMON = 8;
/** An icon is checked between these sizes (dp): larger images are pictures. */
const ICON_DP = [12, 96] as const;

const IMAGE = /(ImageView|ImageButton)$/;
type Rect = NonNullable<UiElement['rect']>;

/**
 * The Android checks of one screen. `scale`: px per dp (density dpi / 160). `clips`: `a11y.read`'s
 * hidden characters per tree node. Elements cut by the window or by a scrolling container's edge are not
 * measured (a list item scrolled half away is not small, its text not clipped).
 */
export function auditAndroid(
  tree: Tree,
  img: Image | null,
  o: { scale: number; clips?: TextClip[]; maxIssues?: number; startedAt?: number },
): AuditResult {
  const els = elementsOf(tree);
  const byRef = new Map(els.map((e, i) => [e.ref, i] as const));
  const children = new Map<number, number[]>();
  els.forEach((e, i) => {
    if (e.parent !== undefined) children.set(e.parent, [...(children.get(e.parent) ?? []), i]);
  });
  const ancestors = (i: number) => {
    const out: number[] = [];
    for (let p = els[i]!.parent; p !== undefined; p = els[p]!.parent) out.push(p);
    return out;
  };
  const descendants = (i: number): number[] =>
    (children.get(i) ?? []).flatMap((c) => [c, ...descendants(c)]);
  const win = els.find((e) => e.parent === undefined && e.rect?.x === 0 && e.rect.y === 0)?.rect;
  const shown = (e: UiElement) =>
    e.visible !== false && !!e.rect && e.rect.width > 0 && e.rect.height > 0;
  const own = (e: UiElement) => (e.label || e.text || '').trim();
  const spoken = (i: number) =>
    [own(els[i]!), ...descendants(i).map((d) => own(els[d]!))].filter(Boolean).join(' ');
  const touches = (r: Rect, a: Rect) =>
    Math.abs(r.x - a.x) <= 1 ||
    Math.abs(r.y - a.y) <= 1 ||
    Math.abs(r.x + r.width - a.x - a.width) <= 1 ||
    Math.abs(r.y + r.height - a.y - a.height) <= 1;
  /** At the window's edge or a scrolling container's: possibly cut there. */
  const cut = (i: number) => {
    const r = els[i]!.rect!;
    return (
      (!!win && touches(r, win)) ||
      ancestors(i).some((a) => els[a]!.scrollable && els[a]!.rect && touches(r, els[a]!.rect!))
    );
  };
  const dp = (px: number) => px / o.scale;

  const issues: AuditIssue[] = [];
  const add = (i: number, type: AuditType, rule: string, message: string) => {
    const e = els[i]!;
    const r = e.rect!;
    issues.push({
      type,
      rule: `android.${rule}`,
      message,
      b: [r.x, r.y, r.x + r.width, r.y + r.height],
      element: {
        c: e.type,
        ...(e.identifier && { id: e.identifier }),
        ...(e.label && { d: e.label }),
        ...(e.text && { t: e.text }),
      },
    });
  };

  const clickable = (e: UiElement) => !!e.clickable;
  els.forEach((e, i) => {
    if (!shown(e) || e.notImportant) return;
    const r = e.rect!;
    const parent = e.parent !== undefined ? els[e.parent] : undefined;
    const twin =
      !!parent &&
      clickable(parent) &&
      parent.rect?.x === r.x &&
      parent.rect.y === r.y &&
      parent.rect.width === r.width &&
      parent.rect.height === r.height;
    const image = IMAGE.test(e.type);

    // touch target
    if (clickable(e) && !twin && Math.min(dp(r.width), dp(r.height)) < TARGET_DP && !cut(i))
      add(
        i,
        'hitRegion',
        'touchTarget',
        `touch target ${Math.round(dp(r.width))}×${Math.round(dp(r.height))} dp, under ${TARGET_DP}×${TARGET_DP} dp`,
      );

    // a name a screen reader can say
    const actionable = clickable(e) || e.editable || (image && e.focusable);
    if (actionable && !twin && !spoken(i) && !(e.editable && e.placeholder))
      add(
        i,
        'sufficientElementDescription',
        image || e.editable ? 'missingLabel' : 'clickableNoLabel',
        e.editable
          ? 'text field without a label or hint'
          : image
            ? 'image control without a content description'
            : 'clickable element without any text or content description',
      );

    if (!img) return;
    /** The rect less `fx`/`fy` of its size on each side: a button's transparent inset is no colour of it. */
    const inner = (fx: number, fy: number) => ({
      x: r.x + fx * r.width,
      y: r.y + fy * r.height,
      w: (1 - 2 * fx) * r.width,
      h: (1 - 2 * fy) * r.height,
    });
    // text against its background: the middle half of its height (the lines), 6 dp in from the sides
    if (e.text?.trim() && dp(r.width) >= 16 && dp(r.height) >= 8) {
      const s = sample(img, inner((6 * o.scale) / r.width, 0.25));
      if (s?.fg && s.bg.share >= CLEAN_TEXT && s.colours <= MAX_COMMON) {
        const ratio = contrastRatio(s.fg.rgb, s.bg.rgb);
        const need = dp(r.height) >= LARGE_TEXT_DP ? LARGE_MIN : TEXT_MIN;
        if (ratio < need)
          add(
            i,
            'contrast',
            'textContrast',
            `text contrast ${ratio.toFixed(2)}:1 (${hex(s.fg.rgb)} on ${hex(s.bg.rgb)}), under ${need}:1`,
          );
      }
    }
    // an icon that is not decoration (it is tapped or named) against what is around it
    const [lo, hi] = ICON_DP;
    if (
      image &&
      (clickable(e) || own(e)) &&
      Math.min(dp(r.width), dp(r.height)) >= lo &&
      Math.max(dp(r.width), dp(r.height)) <= hi
    ) {
      const s = sample(img, inner(0.15, 0.15));
      if (s?.fg && s.bg.share >= CLEAN_ICON && s.colours <= MAX_COMMON) {
        const ratio = contrastRatio(s.fg.rgb, s.bg.rgb);
        if (ratio < LARGE_MIN)
          add(
            i,
            'imageContrast',
            'imageContrast',
            `icon contrast ${ratio.toFixed(2)}:1 (${hex(s.fg.rgb)} on ${hex(s.bg.rgb)}), under ${LARGE_MIN}:1`,
          );
      }
    }
  });

  // text the screen does not show whole (cut by its frame or ellipsized)
  for (const c of o.clips ?? []) {
    const i = byRef.get(`n${c.n}`);
    if (i === undefined || c.hidden === 0 || !shown(els[i]!) || cut(i)) continue;
    add(i, 'textClipped', 'textClipped', `${c.hidden} of ${c.chars} characters are not shown`);
  }

  // controls a screen reader announces alike (the outermost of nested clickables)
  const groups = new Map<string, number[]>();
  els.forEach((e, i) => {
    if (
      !shown(e) ||
      !clickable(e) ||
      e.notImportant ||
      ancestors(i).some((a) => clickable(els[a]!))
    )
      return;
    const name = spoken(i).toLocaleLowerCase();
    if (name) groups.set(name, [...(groups.get(name) ?? []), i]);
  });
  for (const [name, list] of groups)
    if (list.length > 1)
      add(
        list[0]!,
        'duplicateLabel',
        'duplicateLabel',
        `${list.length} controls are read as "${name}"`,
      );

  const max = o.maxIssues ?? 50;
  return {
    engine: 'rules',
    issues: issues.slice(0, max),
    truncated: issues.length > max,
    elapsedMs: o.startedAt === undefined ? 0 : Date.now() - o.startedAt,
  };
}
