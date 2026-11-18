/**
 * The icon as vector and nothing else: a device cut by the curve a dyno pull draws.
 * Every picture the project shows comes from here, through scripts/build-icons.mjs.
 *
 * Two drawings of one idea. From 128 px up, a device on a body of the hub's gradient. At 64 px and below that
 * closes into a ring and reads as a letter, so the body itself becomes the device, cut by the same curve. That
 * second drawing is for a Mac below the glass one: on macOS 26 and later the system draws mac/App/appdyno.icon at
 * every size, and a device with a two-toned inside holds at 16 px there.
 */

/** From the hub's palette, mac/Viewer/Palette.m, as `brand.test.ts` holds them. */
const BLUE = '#3F6BFF';
const VIOLET = '#7A3DF0';
const PINK = '#FF7FD0';
const NIGHT = '#0A0E2E';
const SURFACE = '#1A2460';
const INK = '#12163A';
const PALE = '#F4F6FF';
const QUIET = '#D0D6F2';
const MIST = '#D9DFFF';
const WHITE = '#FFFFFF';

const SVG = 'xmlns="http://www.w3.org/2000/svg"';
/** @param {number} v */
const n = (v) => +v.toFixed(2);

/**
 * A continuous corner. At r = 217 on an 824 body it fits a Mac's own icons to within a pixel.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function rounded(x, y, w, h, r) {
  const [a, b, c, d, e, f, g] = [
    1.528665 * r,
    1.08849 * r,
    0.86841 * r,
    0.63149 * r,
    0.07491 * r,
    0.37282 * r,
    0.16906 * r,
  ];
  const X = x + w;
  const Y = y + h;
  /** @param {...number} v */
  const P = (...v) => v.map(n).join(' ');
  return [
    `M${P(x + a, y)}H${n(X - a)}C${P(X - b, y, X - c, y, X - d, y + e)}`,
    `C${P(X - f, y + g, X - g, y + f, X - e, y + d)}C${P(X, y + c, X, y + b, X, y + a)}`,
    `V${n(Y - a)}C${P(X, Y - b, X, Y - c, X - e, Y - d)}`,
    `C${P(X - g, Y - f, X - f, Y - g, X - d, Y - e)}C${P(X - c, Y, X - b, Y, X - a, Y)}`,
    `H${n(x + a)}C${P(x + b, Y, x + c, Y, x + d, Y - e)}`,
    `C${P(x + f, Y - g, x + g, Y - f, x + e, Y - d)}C${P(x, Y - c, x, Y - b, x, Y - a)}`,
    `V${n(y + a)}C${P(x, y + b, x, y + c, x + e, y + d)}`,
    `C${P(x + g, y + f, x + f, y + g, x + d, y + e)}C${P(x + c, y, x + b, y, x + a, y)}Z`,
  ].join('');
}

/**
 * @param {string} id
 * @param {[number, string, number?][]} stops
 */
const gradient = (id, stops, attributes = 'x1="0" y1="0" x2="0" y2="1"') =>
  `<linearGradient id="${id}" ${attributes}>${stops
    .map(
      ([at, color, alpha = 1]) =>
        `<stop offset="${at}" stop-color="${color}" stop-opacity="${alpha}"/>`,
    )
    .join('')}</linearGradient>`;

const FULL = '<rect width="1024" height="1024" fill="url(#';
const DIAGONAL = 'x1=".2" y1="0" x2=".8" y2="1"';
const GLOW = `<radialGradient id="glow" cx="1" cy="1" r=".95"><stop offset="0" stop-color="${PINK}"/><stop offset="1" stop-color="${PINK}" stop-opacity="0"/></radialGradient>`;

/** The large drawing: a device on the body, with the ground's pink coming up in a corner. */
const SLAB = rounded(262, 128, 500, 768, 112);
const PULL = 'M250 770C390 770 450 660 520 500C580 366 650 300 790 292';
const UNDER_PULL = `${PULL}L790 930L250 930Z`;

function large() {
  const defs =
    gradient(
      'body',
      [
        [0, BLUE],
        [1, VIOLET],
      ],
      DIAGONAL,
    ) +
    GLOW +
    gradient('sky', [
      [0, WHITE, 0.2],
      [0.55, WHITE, 0],
    ]) +
    gradient('light', [
      [0, WHITE, 1],
      [0.45, WHITE, 0.15],
      [1, WHITE, 0],
    ]) +
    gradient('slab', [
      [0, SURFACE],
      [0.4, NIGHT],
    ]) +
    gradient('fill', [
      [0, WHITE],
      [1, MIST],
    ]) +
    '<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="22"/></filter>' +
    `<clipPath id="in"><path d="${SLAB}"/></clipPath>`;
  return (
    `<defs>${defs}</defs>${FULL}body)"/>${FULL}glow)"/>${FULL}sky)"/>` +
    `<path d="${SLAB}" transform="translate(0 18)" fill="#000" opacity=".46" filter="url(#soft)"/>` +
    `<path d="${SLAB}" fill="url(#slab)"/>` +
    `<path d="${SLAB}" fill="none" stroke="url(#light)" stroke-width="8" clip-path="url(#in)" opacity=".28"/>` +
    `<path d="${UNDER_PULL}" fill="url(#fill)" clip-path="url(#in)"/>`
  );
}

/** The small drawing: the curve across the whole body, heavier as the pixels get fewer. */
const CUT = 'M-20 700C260 700 380 610 480 450C570 310 680 262 1044 256';
/** @type {Record<number, number>} */
const RIBBON = { 64: 54, 32: 72, 16: 96 };

/** @param {number} px */
const small = (px) =>
  `<defs>${gradient('up', [
    [0, SURFACE],
    [1, NIGHT],
  ])}${gradient(
    'low',
    [
      [0, BLUE],
      [1, VIOLET],
    ],
    DIAGONAL,
  )}</defs>${FULL}up)"/>` +
  `<path d="${CUT}L1044 1044L-20 1044Z" fill="url(#low)"/>` +
  `<path d="${CUT}" fill="none" stroke="${WHITE}" stroke-width="${String(RIBBON[px])}"/>`;

/** The body on a Mac's canvas, as this Mac's own icons have it: 824 at an inset of 100. */
const BODY = rounded(100, 100, 824, 824, 217);
const IN_BODY = 'translate(100 100) scale(.8046875)';

/**
 * Drawn at exactly `px`, never scaled from a bigger picture.
 * @param {number} px
 */
export function macIcon(px) {
  const large_ = px > 64;
  const shadow = large_
    ? `<path d="${BODY}" transform="translate(0 12)" fill="#000" opacity=".3" filter="url(#drop)"/>`
    : '';
  const rim = large_
    ? `<path d="${BODY}" fill="none" stroke="url(#rim)" stroke-width="6" clip-path="url(#mask)"/>`
    : '';
  return (
    `<svg ${SVG} width="${px}" height="${px}" viewBox="0 0 1024 1024"><defs>` +
    `<clipPath id="mask"><path d="${BODY}"/></clipPath>` +
    '<filter id="drop" x="-10%" y="-10%" width="120%" height="125%"><feGaussianBlur stdDeviation="16"/></filter>' +
    gradient('rim', [
      [0, WHITE, 0.55],
      [0.5, WHITE, 0.08],
      [1, WHITE, 0.2],
    ]) +
    `</defs>${shadow}<g clip-path="url(#mask)"><g transform="${IN_BODY}">` +
    `${large_ ? large() : small(px)}</g></g>${rim}</svg>`
  );
}

/**
 * Full bleed: iOS masks it.
 * @param {number} px
 */
export const iosIcon = (px) =>
  `<svg ${SVG} width="${px}" height="${px}" viewBox="0 0 1024 1024">${large()}</svg>`;

/**
 * The curve as two closed parts with a gap, so a mark needs no mask and works in any colour.
 * @param {number} r
 * @param {number} gap
 */
const upper = (r, gap) =>
  `M0 ${700 - gap}C260 ${700 - gap} 380 ${610 - gap} 480 ${450 - gap}C570 ${310 - gap} 680 ${262 - gap} 1024 ${256 - gap}` +
  `V${r}A${r} ${r} 0 0 0 ${1024 - r} 0H${r}A${r} ${r} 0 0 0 0 ${r}Z`;
/**
 * @param {number} r
 * @param {number} gap
 */
const lower = (r, gap) =>
  `M0 ${700 + gap}C260 ${700 + gap} 380 ${610 + gap} 480 ${450 + gap}C570 ${310 + gap} 680 ${262 + gap} 1024 ${256 + gap}` +
  `V${1024 - r}A${r} ${r} 0 0 1 ${1024 - r} 1024H${r}A${r} ${r} 0 0 1 0 ${1024 - r}Z`;
const MARK_UPPER = upper(240, 66);
const MARK_LOWER = lower(240, 66);

/**
 * @param {string} top
 * @param {string} bottom
 */
const mark = (top, bottom, attributes = '') =>
  `<svg ${attributes}viewBox="0 0 1024 1024"><path d="${MARK_UPPER}" fill="${top}"/><path d="${MARK_LOWER}" fill="${bottom}"/></svg>`;

/**
 * The menu bar's glyph: only its shape counts, as a template image.
 * @param {number} px
 */
export const menuGlyph = (px) =>
  mark('#000', '#000', `${SVG} width="${px}" height="${px}" `).replace(
    'viewBox="0 0 1024 1024"',
    'viewBox="-48 -48 1120 1120"',
  );

/** Follows the page's ink and accent, so it holds in light and in dark, and on paper. */
export const PAGE_MARK = mark('currentColor', 'var(--series)', 'class="mark" aria-hidden="true" ');
/** Stands alone, so it brings its own colours. */
export const SERVER_ICON = mark(BLUE, VIOLET, `${SVG} `);

/**
 * Letters from a ring and a stem, so that a logo depends on no font.
 * @param {number} x
 * @param {number} baseline
 * @param {number} height
 * @param {string} stroke
 */
function wordmark(x, baseline, height, stroke) {
  const r = height / 2;
  const width = height * 0.2;
  const top = baseline - height;
  const middle = baseline - r;
  const reach = height * 0.62;
  /** @param {number} at */
  const ring = (at) => `<circle cx="${n(at + r)}" cy="${n(middle)}" r="${n(r - width / 2)}"/>`;
  /** @param {string} d */
  const line = (d) => `<path d="${d}"/>`;
  /** @type {Record<'a' | 'p' | 'd' | 'y' | 'n' | 'o', (at: number) => string>} */
  const letters = {
    a: (at) => ring(at) + line(`M${n(at + height - width / 2)} ${n(top + width / 2)}V${baseline}`),
    p: (at) =>
      ring(at) + line(`M${n(at + width / 2)} ${n(top + width / 2)}V${n(baseline + reach)}`),
    d: (at) => ring(at) + line(`M${n(at + height - width / 2)} ${n(top - reach)}V${baseline}`),
    y: (at) =>
      line(`M${n(at + width / 2)} ${n(top + width / 2)}L${n(at + r)} ${baseline}`) +
      line(
        `M${n(at + height - width / 2)} ${n(top + width / 2)}L${n(at + height * 0.25)} ${n(baseline + reach)}`,
      ),
    n: (at) =>
      line(
        `M${n(at + width / 2)} ${baseline}V${n(middle)}a${n(r - width / 2)} ${n(r - width / 2)} 0 0 1 ${n(height - width)} 0V${baseline}`,
      ),
    o: ring,
  };
  const advance = height + height * 0.28;
  /** @type {(keyof typeof letters)[]} */
  const word = ['a', 'p', 'p', 'd', 'y', 'n', 'o'];
  const drawn = word.map((letter, i) => letters[letter](x + i * advance)).join('');
  return {
    width: 7 * advance - height * 0.28,
    svg: `<g class="word" fill="none" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round">${drawn}</g>`,
  };
}

/**
 * For the README, one for each theme: the README's <picture> picks by GitHub's theme, where a media query in the SVG
 * would follow the system's, light letters on a light page. The mark holds on both.
 */
export function logo(letters = INK) {
  const word = wordmark(176, 134, 76, letters);
  const width = Math.ceil(176 + word.width + 8);
  return (
    `<svg ${SVG} width="${width}" height="192" viewBox="0 0 ${width} 192" role="img" aria-label="appdyno">` +
    `<g transform="translate(16 36) scale(.1171875)"><path d="${MARK_UPPER}" fill="${BLUE}"/><path d="${MARK_LOWER}" fill="${VIOLET}"/></g>` +
    `${word.svg}</svg>\n`
  );
}

/** A repository's preview, 1280 by 640, with the README's line: what a shared link shows first. */
/** The hub's picture on the social card: its stage and Inspector, left of the sidebar, in pixels of docs/images/hub.webp. */
const SHOT = { from: 244, width: 1240, height: 820, x: 628, y: 64, shown: 612 };

/**
 * GitHub's card for a link to the repository: the mark, the name and the README's first line, beside the hub at work.
 * @param {string} hub docs/images/hub.webp as a PNG, base64
 */
export function social(hub) {
  const [w, h] = [1280, 640];
  const blooms = BLOOMS.map(
    ([x, y, reach, strength, color], i) =>
      `<radialGradient id="s${String(i)}" gradientUnits="userSpaceOnUse" cx="${n(x * w)}" cy="${n(y * h)}" r="${n(reach * w)}">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="${n(strength * 0.8)}"/>` +
      `<stop offset=".5" stop-color="${color}" stop-opacity="${n(strength * 0.25)}"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  const word = wordmark(72, 336, 58, PALE);
  // a text each, as sips draws no tspan where it is placed
  const line = (/** @type {number} */ y, /** @type {string} */ text) =>
    `<text x="72" y="${y}" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="30" fill="${QUIET}">${text}</text>`;
  const scale = SHOT.shown / (SHOT.width - SHOT.from);
  const shown = { w: SHOT.shown, h: n(SHOT.height * scale) };
  const frame = `x="${SHOT.x}" y="${SHOT.y}" width="${shown.w}" height="${shown.h}" rx="18"`;
  return (
    `<svg ${SVG} width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${blooms.join('')}` +
    `<clipPath id="shot"><rect ${frame}/></clipPath>` +
    `<filter id="lift" x="-10%" y="-10%" width="120%" height="130%"><feGaussianBlur stdDeviation="18"/></filter></defs>` +
    `<rect width="${w}" height="${h}" fill="${NIGHT}"/>` +
    blooms.map((_, i) => `<rect width="${w}" height="${h}" fill="url(#s${String(i)})"/>`).join('') +
    `<g transform="translate(72 96) scale(.1171875)">${macIcon(1024).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>` +
    `${word.svg}${line(430, 'Let an AI agent drive, test and')}${line(472, 'measure your iOS and Android app.')}` +
    `<rect ${frame} fill="${NIGHT}" opacity=".7" filter="url(#lift)" transform="translate(0 14)"/>` +
    `<image x="${n(SHOT.x - SHOT.from * scale)}" y="${SHOT.y}" width="${n(SHOT.width * scale)}" height="${shown.h}" ` +
    `clip-path="url(#shot)" href="data:image/png;base64,${hub}"/>` +
    `<rect ${frame} fill="none" stroke="${PALE}" stroke-opacity=".22" stroke-width="1.5"/></svg>\n`
  );
}

/**
 * The disk image's window in points, from its top left: the room under its title bar, and where the app and Applications
 * stand, each the centre of its icon. `hidden` is where the two files Finder hides stand, the dragon's place: Finder lays
 * out a hidden file as any other, and one placed below the room is room to scroll to. scripts/build-app.mjs writes the
 * same into the image's .DS_Store, the window `title` taller than `size` as macOS 26 draws its title bar.
 * @type {{ size: [number, number]; title: number; icon: number; text: number; app: [number, number]; applications: [number, number]; hidden: [number, number] }}
 */
export const DMG = {
  size: [720, 400],
  title: 32,
  icon: 128,
  text: 13,
  app: [150, 214],
  applications: [430, 214],
  hidden: [612, 190],
};

/** The ground of the hub in dark (mac/Viewer/Palette.m): where each bloom is, as shares of the window, its reach and strength. */
const BLOOMS = /** @type {const} */ ([
  [0.98, 0.04, 0.34, 0.86, '#1F3FD6'],
  [0, 1, 0.36, 0.86, '#5B1FC4'],
  [0.94, 1.04, 0.24, 0.66, '#B81C68'],
  [0.02, 0, 0.2, 0.5, '#0B6DBD'],
]);
/** The same in light, which the disk image wears as the site does. */
const LIGHT_BLOOMS = /** @type {const} */ ([
  [0.98, 0.04, 0.42, 1, '#A6B8FF'],
  [0, 1, 0.44, 1, '#D3AFFF'],
  [0.94, 1.04, 0.3, 0.92, '#FFB3D1'],
  [0.02, 0, 0.26, 0.8, '#A8DEFF'],
]);
const GROUND = '#EEF0FF';
const ACCENT_FROM = '#2F52F0';
const ACCENT_TO = '#7A2EE0';
/** Below the room, as an older Finder's title bar is shorter: the ground, never white. */
const BLEED = 40;
const FONT = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif" text-anchor="middle"';

/** @param {string} color */
const rgb = (color) => [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
/**
 * WCAG's relative luminance.
 * @param {string} color
 */
export function luminance(color) {
  const linear = (/** @type {number} */ v) =>
    v / 255 <= 0.04045 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4;
  const [r = 0, g = 0, b = 0] = rgb(color).map(linear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The plate under an icon's name. Finder writes a name in black or in white, by the person's light or dark, whatever the
 * picture, so both must read on it, which only a narrow band of luminance around 0.179 allows: the accent's violet,
 * lightened to the middle of it. `brand.test.ts` holds the picture sips draws to 4.5:1 for each.
 */
export const PLATE = (() => {
  const middle = Math.sqrt(1.05 * 0.05) - 0.05;
  const toward = (/** @type {number} */ t) =>
    `#${rgb(ACCENT_TO)
      .map((v) =>
        Math.round(v + (255 - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`;
  let [lo, hi] = [0, 1];
  for (let i = 0; i < 20; i += 1) {
    const t = (lo + hi) / 2;
    if (luminance(toward(t)) < middle) lo = t;
    else hi = t;
  }
  return toward(lo);
})();

/**
 * The disk image's background, `scale` pixels to a point: the house's light ground, the way from the app to
 * Applications in one stroke of the accent, and the site's dragon beside Applications, turned to the app, waiting for
 * it. `dragon` is scripts/render-dragon.py's still, mac/App/dragon.png, as base64: drawn at twice the size it stands.
 * @param {number} scale
 * @param {string} dragon
 */
export function dmgBackground(scale, dragon) {
  const [w, h] = DMG.size;
  const H = h + BLEED;
  const half = DMG.icon / 2;
  const blooms = LIGHT_BLOOMS.map(
    ([x, y, reach, strength, color], i) =>
      `<radialGradient id="b${String(i)}" gradientUnits="userSpaceOnUse" cx="${n(x * w)}" cy="${n(y * h)}" r="${n(reach * w * 1.5)}">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="${String(strength)}"/>` +
      `<stop offset=".5" stop-color="${color}" stop-opacity="${n(strength * 0.35)}"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  /** Where an icon stands: a pool of light behind it, its shadow on the floor, and a plate as wide as its name. */
  const stand = (/** @type {[number, number]} */ [x, y], /** @type {number} */ wide) => {
    const plate = `x="${x - wide / 2}" y="${y + half + 1}" width="${wide}" height="24" rx="12"`;
    return (
      `<circle cx="${x}" cy="${y}" r="${half + 34}" fill="url(#pool)"/>` +
      `<ellipse cx="${x}" cy="${y + half - 2}" rx="${half - 6}" ry="12" fill="url(#shade)"/>` +
      `<rect ${plate} fill="${PLATE}"/><rect ${plate} fill="none" stroke="${WHITE}" stroke-opacity=".5"/>`
    );
  };
  // one stroke over the gap, from beside the app to beside Applications, rising as a hand that carries it would
  const [x0, x1, y] = [DMG.app[0] + half + 16, DMG.applications[0] - half - 18, DMG.app[1] - 6];
  const way = `M${x0} ${y}Q${(x0 + x1) / 2} ${y - 84} ${x1} ${y}`;
  const angle = Math.atan2(84, (x1 - x0) / 2);
  const tip = (/** @type {number} */ turn) =>
    `${n(x1 - 15 * Math.cos(angle + turn))} ${n(y - 15 * Math.sin(angle + turn))}`;
  // its feet on the floor, at half the size it was drawn: mac/App/dragon.png is 378 by 440
  const [dw, dh] = [189, 220];
  const [dx, feet] = [DMG.hidden[0] - dw / 2 + 6, DMG.app[1] + half + 22];
  return (
    `<svg ${SVG} width="${w * scale}" height="${H * scale}" viewBox="0 0 ${w} ${H}"><defs>${blooms.join('')}` +
    gradient('floor', [
      [0, GROUND],
      [1, MIST],
    ]) +
    gradient(
      'lit',
      [
        [0, ACCENT_FROM],
        [0.6, ACCENT_TO],
        [1, PINK],
      ],
      'x1="0" y1="0" x2="1" y2="0"',
    ) +
    `<radialGradient id="pool"><stop offset="0" stop-color="${WHITE}" stop-opacity=".95"/><stop offset=".55" stop-color="${WHITE}" stop-opacity=".5"/><stop offset="1" stop-color="${WHITE}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="shade"><stop offset="0" stop-color="${ACCENT_TO}" stop-opacity=".28"/><stop offset="1" stop-color="${ACCENT_TO}" stop-opacity="0"/></radialGradient>` +
    '<filter id="soft" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="6"/></filter></defs>' +
    `<rect width="${w}" height="${H}" fill="url(#floor)"/>` +
    blooms.map((_, i) => `<rect width="${w}" height="${H}" fill="url(#b${String(i)})"/>`).join('') +
    `<text x="${w / 2}" y="60" ${FONT} font-size="24" font-weight="600" fill="${INK}">Drag appdyno to Applications</text>` +
    `<ellipse cx="${DMG.hidden[0]}" cy="${feet}" rx="150" ry="24" fill="${WHITE}" opacity=".55" filter="url(#soft)"/>` +
    stand(DMG.app, 84) +
    stand(DMG.applications, 104) +
    `<path d="${way}" fill="none" stroke="url(#lit)" stroke-width="10" stroke-linecap="round" opacity=".25" filter="url(#soft)"/>` +
    `<path d="${way}M${tip(0.6)}L${x1} ${y}L${tip(-0.6)}" fill="none" stroke="url(#lit)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<ellipse cx="${DMG.hidden[0] + 4}" cy="${feet - 4}" rx="56" ry="9" fill="${ACCENT_TO}" opacity=".2" filter="url(#soft)"/>` +
    `<g transform="translate(${n(dx + dw)} ${n(feet - dh)}) scale(-1 1)"><image width="${dw}" height="${dh}" href="data:image/png;base64,${dragon}"/></g>` +
    '</svg>\n'
  );
}

/** @param {string} body */
const layer = (body) =>
  `<svg ${SVG} width="1024" height="1024" viewBox="0 0 1024 1024">${body}</svg>\n`;

/** The fixture's launcher, in Android's vector form: no picture to go stale. */
const androidArt = `<?xml version="1.0" encoding="utf-8"?>
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="108dp"
    android:height="108dp"
    android:viewportWidth="1024"
    android:viewportHeight="1024">
    <path android:fillColor="${SURFACE}" android:pathData="M0 0H1024V1024H0Z" />
    <path android:fillColor="${BLUE}" android:pathData="${CUT}L1044 1044L-20 1044Z" />
    <path android:strokeColor="${WHITE}" android:strokeWidth="${String(RIBBON[16])}" android:pathData="${CUT}" />
</vector>
`;

/** Every generated text in the repository, by path, so that a test can hold them to this file. */
export const GENERATED = {
  'docs/images/logo.svg': logo(),
  'docs/images/logo.dark.svg': logo(PALE),
  'mac/App/appdyno.icon/Assets/slab.svg': layer(`<path d="${SLAB}" fill="${NIGHT}"/>`),
  'mac/App/appdyno.icon/Assets/curve.svg': layer(
    `<defs><clipPath id="in"><path d="${SLAB}"/></clipPath></defs><path d="${UNDER_PULL}" fill="${WHITE}" clip-path="url(#in)"/>`,
  ),
  'mac/App/appdyno.icon/Assets/glow.svg': layer(
    `<defs>${GLOW}</defs><rect width="1024" height="1024" fill="url(#glow)"/>`,
  ),
  'mac/App/appdyno.icon/icon.json': `${JSON.stringify(
    {
      fill: {
        'linear-gradient': [
          'extended-srgb:0.24706,0.41961,1.00000,1.00000',
          'extended-srgb:0.47843,0.23922,0.94118,1.00000',
        ],
        orientation: { start: { x: 0.2, y: 0 }, stop: { x: 0.8, y: 1 } },
      },
      groups: [
        {
          layers: [{ 'image-name': 'curve.svg', name: 'curve', glass: true }],
          shadow: { kind: 'neutral', opacity: 0.4 },
          translucency: { enabled: true, value: 0.2 },
        },
        {
          layers: [{ 'image-name': 'slab.svg', name: 'slab', glass: true }],
          shadow: { kind: 'neutral', opacity: 0.5 },
          translucency: { enabled: false, value: 0.5 },
        },
        {
          // a stain on the black body of the dark icon, which the system draws for itself
          layers: [
            {
              'image-name': 'glow.svg',
              name: 'glow',
              glass: false,
              'hidden-specializations': [{ appearance: 'dark', value: true }],
            },
          ],
        },
      ],
      'supported-platforms': { squares: ['macOS'] },
    },
    null,
    2,
  )}\n`,
  'android/fixture/src/main/res/drawable/ic_launcher_art.xml': androidArt,
  'android/fixture/src/main/res/drawable/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<inset xmlns:android="http://schemas.android.com/apk/res/android" android:drawable="@drawable/ic_launcher_art" />
`,
  'android/fixture/src/main/res/drawable-anydpi-v26/ic_launcher.xml': `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@drawable/ic_launcher_art" />
    <foreground android:drawable="@android:color/transparent" />
</adaptive-icon>
`,
  'packages/core/src/mark.ts': `// Generated by scripts/build-icons.mjs from scripts/icon-art.mjs.

/** The mark every page shows: drawn inline, as a page loads nothing. */
export const PAGE_MARK =
  '${PAGE_MARK}';

/** The mark on its own, as a client shows it for the server. */
export const SERVER_ICON_SVG =
  '${SERVER_ICON}';
`,
};
