import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { NODE_FLAGS, type Tree, type WireNode } from '@appdyno/protocol';
import { decodePng, type Image } from '@appdyno/core';
import { auditAndroid, contrastRatio } from '../src/audit.js';

/** A 1080×2400 screen at 2.625 px/dp (420 dpi), white, every pixel `fill` until painted. */
const W = 1080;
const H = 2400;
const SCALE = 420 / 160;
const canvas = (): Image => ({
  width: W,
  height: H,
  channels: 4,
  data: new Uint8Array(W * H * 4).fill(255),
});
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function paint(img: Image, [l, t, r, b]: number[], hex: string) {
  const [R, G, B] = rgb(hex);
  for (let y = t!; y < b!; y++)
    for (let x = l!; x < r!; x++) img.data.set([R!, G!, B!, 255], (y * img.width + x) * 4);
}
/** Text-like strokes of `hex` inside a box: 3 px bars every 12 px, the middle half of its height. */
function strokes(img: Image, [l, t, r, b]: number[], hex: string) {
  const h = b! - t!;
  for (let x = l! + 4; x + 3 <= r! - 4; x += 12)
    paint(img, [x, t! + h / 4, x + 3, b! - h / 4], hex);
}
/** PNG of an RGBA image, every row filter 1 (Sub), as a device's encoder may write it. */
function encodePng(img: Image): Buffer {
  const stride = img.width * 4;
  const raw = Buffer.alloc(img.height * (stride + 1));
  for (let y = 0; y < img.height; y++) {
    raw[y * (stride + 1)] = 1;
    for (let x = 0; x < stride; x++) {
      const v = img.data[y * stride + x]!;
      raw[y * (stride + 1) + 1 + x] = (v - (x >= 4 ? img.data[y * stride + x - 4]! : 0)) & 255;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0);
  ihdr.writeUInt32BE(img.height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const F = NODE_FLAGS;
const V = F.visible | F.enabled;
const C = V | F.clickable | F.focusable;
type N = Partial<WireNode> & { b: [number, number, number, number] };
/** The app's window with a full-screen root (node 0) and `nodes` under it (parent 0 unless given). */
const tree = (...nodes: N[]): Tree => ({
  windows: [
    { type: 1, pkg: 'com.example', layer: 0, b: [0, 0, W, H], active: true, focused: true },
  ],
  nodes: [
    { p: -1, w: 0, c: 'android.widget.FrameLayout', b: [0, 0, W, H], f: V },
    ...nodes.map((n) => ({ p: 0, w: 0, c: 'android.widget.TextView', f: V, ...n })),
  ],
  truncated: false,
  elapsedMs: 1,
  hash: 'h',
});
const audit = (
  t: Tree,
  img: Image | null = null,
  clips?: { n: number; chars: number; hidden: number }[],
) =>
  auditAndroid(t, img, { scale: SCALE, ...(clips && { clips }) }).issues.map((i) => [
    i.type,
    i.rule,
    i.element?.id ?? i.element?.d ?? i.element?.t,
  ]);

describe('android accessibility checks', () => {
  it('a control under 48×48 dp is a small touch target; its clickable child of the same box is not counted twice', () => {
    const t = tree(
      { c: 'android.widget.Button', id: 'small', d: 'Küçük', b: [100, 100, 163, 163], f: C },
      { p: 1, c: 'android.view.View', b: [100, 100, 163, 163], f: C },
      { c: 'android.widget.Button', id: 'big', t: 'Devam', b: [100, 300, 1000, 440], f: C },
    );
    expect(audit(t)).toEqual([['hitRegion', 'android.touchTarget', 'small']]);
  });

  it('a target cut by a scrolling list or the screen edge is not measured', () => {
    const t = tree(
      { c: 'androidx.recyclerview.widget.RecyclerView', b: [0, 500, W, 1500], f: V | F.scrollable },
      { p: 1, c: 'android.widget.Button', t: 'Ekle', b: [100, 1460, 400, 1500], f: C },
      { c: 'android.widget.Button', t: 'Kapat', b: [0, 2380, 300, H], f: C },
    );
    expect(audit(t)).toEqual([]);
  });

  it('an unnamed icon button, a field without label or hint, and a clickable row without text', () => {
    const t = tree(
      { c: 'android.widget.ImageButton', id: 'icon', b: [100, 100, 247, 247], f: C },
      { c: 'android.widget.EditText', id: 'field', b: [100, 300, 1000, 440], f: C | F.editable },
      {
        c: 'android.widget.EditText',
        id: 'hinted',
        h: 'Adınız',
        b: [100, 500, 1000, 640],
        f: C | F.editable,
      },
      { c: 'android.widget.LinearLayout', id: 'row', b: [0, 700, W, 900], f: C },
      { c: 'android.widget.LinearLayout', id: 'named', b: [0, 900, W, 1100], f: C },
      { p: 5, c: 'android.widget.TextView', t: 'Adresler', b: [40, 950, 600, 1050], f: V },
    );
    expect(audit(t)).toEqual([
      ['sufficientElementDescription', 'android.missingLabel', 'icon'],
      ['sufficientElementDescription', 'android.missingLabel', 'field'],
      ['sufficientElementDescription', 'android.clickableNoLabel', 'row'],
    ]);
  });

  it('a node a screen reader skips (not important) is not checked', () => {
    const t = tree({
      c: 'android.widget.ImageButton',
      id: 'icon',
      b: [100, 100, 247, 247],
      f: C | F.notImportant,
    });
    expect(audit(t)).toEqual([]);
  });

  it('faint text is low contrast, dark text is not; large text needs 3:1', () => {
    const img = canvas();
    const faint: [number, number, number, number] = [100, 100, 700, 160];
    const dark: [number, number, number, number] = [100, 300, 700, 360];
    const large: [number, number, number, number] = [100, 500, 900, 600];
    strokes(img, faint, '#C8C8C8');
    strokes(img, dark, '#222222');
    strokes(img, large, '#8C8C8C');
    const t = tree(
      { id: 'faint', t: 'Soluk metin', b: faint },
      { id: 'dark', t: 'Koyu metin', b: dark },
      { id: 'large', t: 'Büyük başlık', b: large },
    );
    const r = auditAndroid(t, decodePng(encodePng(img)), { scale: SCALE });
    expect(r.issues.map((i) => [i.type, i.element?.id])).toEqual([['contrast', 'faint']]);
    expect(r.issues[0]!.message).toMatch(
      /^text contrast 1\.\d\d:1 \(#C[0-9A-F]{5} on #F[0-9A-F]{5}\), under 4\.5:1$/,
    );
    expect(contrastRatio([0x8c, 0x8c, 0x8c], [255, 255, 255])).toBeGreaterThan(3);
  });

  it("a button's transparent inset (the page around its fill) is not taken for its text colour", () => {
    // Material's button: a grey fill 16 px in from its box, dark text in the middle (live: 1.42:1 filed)
    const img = canvas();
    const b: [number, number, number, number] = [32, 558, 1048, 684];
    paint(img, [b[0] + 10, b[1] + 16, b[2] - 10, b[3] - 16], '#D6D7D7');
    strokes(img, [440, 600, 640, 642], '#212121');
    const t = tree({ c: 'android.widget.Button', id: 'add', t: 'EKLE', b, f: C });
    expect(auditAndroid(t, decodePng(encodePng(img)), { scale: SCALE }).issues).toEqual([]);
  });

  it('a faint icon a person taps is low contrast; a photo and a decoration are not measured', () => {
    const img = canvas();
    paint(img, [140, 140, 200, 200], '#E2E2E2');
    paint(img, [140, 340, 200, 400], '#E2E2E2');
    // a photo: many colours
    for (let y = 500; y < 640; y += 4)
      for (let x = 100; x < 240; x += 4)
        paint(
          img,
          [x, y, x + 4, y + 4],
          `#${((x * 7 + y * 13) % 0xffffff).toString(16).padStart(6, '0')}`,
        );
    const t = tree(
      {
        c: 'android.widget.ImageView',
        id: 'faint_icon',
        d: 'Soluk simge',
        b: [100, 100, 240, 240],
        f: C,
      },
      { c: 'android.widget.ImageView', id: 'decoration', b: [100, 300, 240, 440], f: V },
      { c: 'android.widget.ImageView', id: 'photo', d: 'Ürün', b: [100, 500, 240, 640], f: C },
    );
    expect(audit(t, decodePng(encodePng(img)))).toEqual([
      ['imageContrast', 'android.imageContrast', 'faint_icon'],
    ]);
  });

  it('text with hidden characters is clipped, unless a scrolling list cuts it', () => {
    const t = tree(
      { id: 'cut', t: 'Uzun bir metin', b: [100, 100, 400, 160] },
      { id: 'whole', t: 'Kısa', b: [100, 200, 400, 260] },
      { c: 'android.widget.ScrollView', b: [0, 300, W, 1000], f: V | F.scrollable },
      { p: 3, id: 'scrolled', t: 'Kaydırılmış metin', b: [100, 940, 400, 1000] },
    );
    const clips = [
      { n: 1, chars: 14, hidden: 6 },
      { n: 2, chars: 4, hidden: 0 },
      { n: 4, chars: 17, hidden: 5 },
    ];
    expect(audit(t, null, clips)).toEqual([['textClipped', 'android.textClipped', 'cut']]);
  });

  it('two controls read alike are one duplicate-label issue', () => {
    const t = tree(
      { c: 'android.widget.Button', id: 'add_1', t: 'Ekle', b: [100, 100, 1000, 240], f: C },
      { c: 'android.widget.Button', id: 'add_2', t: 'ekle', b: [100, 300, 1000, 440], f: C },
      { c: 'android.widget.Button', id: 'other', t: 'Sil', b: [100, 500, 1000, 640], f: C },
    );
    const r = auditAndroid(t, null, { scale: SCALE });
    expect(r.issues.map((i) => [i.type, i.element?.id, i.message])).toEqual([
      ['duplicateLabel', 'add_1', '2 controls are read as "ekle"'],
    ]);
  });

  it('keeps at most maxIssues and says it cut the list', () => {
    const t = tree(
      ...Array.from({ length: 5 }, (_, k): N => ({
        c: 'android.widget.ImageButton',
        id: `i${k}`,
        b: [100, 100 + k * 200, 247, 247 + k * 200],
        f: C,
      })),
    );
    const r = auditAndroid(t, null, { scale: SCALE, maxIssues: 3 });
    expect([r.engine, r.issues.length, r.truncated]).toEqual(['rules', 3, true]);
  });

  it('decodes every PNG row filter it may meet and refuses what it cannot', () => {
    const img = canvas();
    paint(img, [10, 10, 50, 50], '#123456');
    const back = decodePng(encodePng(img))!;
    expect([back.width, back.height, back.channels]).toEqual([W, H, 4]);
    expect(Array.from(back.data.subarray((20 * W + 20) * 4, (20 * W + 20) * 4 + 4))).toEqual([
      0x12, 0x34, 0x56, 255,
    ]);
    expect(decodePng(Buffer.from('not a png'))).toBeNull();
  });

  it("the fixture app's accessibility screen as an emulator read it: each known problem, nothing on the clean parts", () => {
    // fixtures/android-a11y: one a11y.read and the screenshot after it (Pixel 7 emulator, Android 15)
    const dir = join(import.meta.dirname, 'fixtures/android-a11y');
    const read = JSON.parse(readFileSync(join(dir, 'read.json'), 'utf8')) as {
      density: number;
      tree: Tree;
      clips: { n: number; chars: number; hidden: number }[];
    };
    const img = decodePng(readFileSync(join(dir, 'screen.png')));
    expect(img).not.toBeNull();
    const r = auditAndroid(read.tree, img, { scale: read.density / 160, clips: read.clips });
    const of = (id: string) =>
      r.issues
        .filter((i) => i.element?.id === `dev.appdyno.fixture:id/${id}`)
        .map((i) => i.rule)
        .sort();
    expect(of('a11y_faint')).toEqual(['android.textContrast']);
    expect(of('a11y_small')).toEqual(['android.touchTarget']);
    expect(of('a11y_icon')).toContain('android.missingLabel');
    expect(of('a11y_faint_icon')).toEqual(['android.imageContrast']);
    expect(of('a11y_add_1')).toEqual(['android.duplicateLabel']);
    expect(of('a11y_cut')).toEqual(['android.textClipped']);
    expect(of('a11y_ellipsized')).toEqual(['android.textClipped']);
    for (const id of ['title', 'a11y_ok', 'a11y_add_2', 'a11y_name', 'a11y_price'])
      expect(of(id), id).toEqual([]);
  });
});
