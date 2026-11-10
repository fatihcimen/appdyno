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

/** A repository's preview, 1280 by 640. */
export function social() {
  const word = wordmark(470, 318, 84, PALE);
  return (
    `<svg ${SVG} width="1280" height="640" viewBox="0 0 1280 640"><rect width="1280" height="640" fill="${NIGHT}"/>` +
    `<g transform="translate(70 140) scale(.3515625)">${macIcon(1024).replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>` +
    `${word.svg}<text x="470" y="436" font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-size="42" fill="${QUIET}">Real numbers from a real device.</text></svg>\n`
  );
}

/**
 * The disk image's window in points, from its top left: its size, and where the app and Applications stand, each the
 * centre of its icon. scripts/build-app.mjs writes the same into the image's .DS_Store.
 * @type {{ size: [number, number]; icon: number; text: number; app: [number, number]; applications: [number, number] }}
 */
export const DMG = {
  size: [640, 400],
  icon: 128,
  text: 13,
  app: [160, 204],
  applications: [480, 204],
};

/** The ground of the hub in dark (mac/Viewer/Palette.m): where each bloom is, as shares of the window, its reach and strength. */
const BLOOMS = /** @type {const} */ ([
  [0.98, 0.04, 0.34, 0.86, '#1F3FD6'],
  [0, 1, 0.36, 0.86, '#5B1FC4'],
  [0.94, 1.04, 0.24, 0.66, '#B81C68'],
  [0.02, 0, 0.2, 0.5, '#0B6DBD'],
]);
/** Past the window on the right and below, as Finder's title bar may take some of its height: the ground, never white. */
const BLEED = 40;
const FONT = 'font-family="Helvetica Neue, Helvetica, Arial, sans-serif" text-anchor="middle"';

/**
 * The disk image's background, `scale` pixels to a point. Finder may draw the names under the icons in black or in
 * white, by the person's light or dark: each stands on the hub's blue, darkened until black and white text both read on
 * it at 4.5:1 or more as drawn, #4170DA, as sips draws an SVG's colours a little lighter than they are written.
 * @param {number} scale
 */
export function dmgBackground(scale) {
  const [w, h] = DMG.size;
  const [W, H] = [w + BLEED, h + BLEED];
  const half = DMG.icon / 2;
  const blooms = BLOOMS.map(
    ([x, y, reach, strength, color], i) =>
      `<radialGradient id="b${String(i)}" gradientUnits="userSpaceOnUse" cx="${n(x * w)}" cy="${n(y * h)}" r="${n(reach * w * 1.6)}">` +
      `<stop offset="0" stop-color="${color}" stop-opacity="${String(strength)}"/>` +
      `<stop offset=".45" stop-color="${color}" stop-opacity="${n(strength * 0.35)}"/>` +
      `<stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
  );
  /** A pane of glass under an icon, and its name on a plate of light at its foot. */
  const well = (/** @type {[number, number]} */ [x, y]) => {
    const body = rounded(x - 88, y - half - 24, 176, DMG.icon + 70, 36);
    const plate = `x="${x - 66}" y="${y + half - 2}" width="132" height="28" rx="14"`;
    return (
      `<path d="${body}" fill="url(#glass)"/>` +
      `<path d="${body}" fill="none" stroke="url(#rim)" stroke-width="1.5"/>` +
      `<rect ${plate} fill="${BLUE}" filter="url(#halo)" opacity=".7"/>` +
      `<rect ${plate} fill="${BLUE}"/><rect ${plate} fill="${NIGHT}" opacity=".22"/>` +
      `<rect ${plate} fill="none" stroke="url(#rim)" stroke-width="1"/>`
    );
  };
  // from a pane of glass to the next, 22 points short of each
  const [from, to] = [DMG.app[0] + 110, DMG.applications[0] - 110];
  const y = DMG.app[1];
  const arrow = `M${from} ${y}H${to}M${to - 13} ${y - 13}L${to} ${y}L${to - 13} ${y + 13}`;
  return (
    `<svg ${SVG} width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}"><defs>${blooms.join('')}` +
    gradient(
      'lit',
      [
        [0, BLUE],
        [0.55, VIOLET],
        [1, PINK],
      ],
      'x1="0" y1="0" x2="1" y2="0"',
    ) +
    gradient('glass', [
      [0, WHITE, 0.1],
      [1, WHITE, 0.04],
    ]) +
    gradient('rim', [
      [0, WHITE, 0.4],
      [0.5, WHITE, 0.08],
      [1, WHITE, 0.16],
    ]) +
    '<filter id="soft" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="7"/></filter>' +
    '<filter id="halo" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="9"/></filter></defs>' +
    `<rect width="${W}" height="${H}" fill="${NIGHT}"/>` +
    blooms.map((_, i) => `<rect width="${W}" height="${H}" fill="url(#b${String(i)})"/>`).join('') +
    `<text x="${w / 2}" y="70" ${FONT} font-size="22" font-weight="500" fill="${PALE}">Drag appdyno to Applications</text>` +
    `<text x="${w / 2}" y="96" ${FONT} font-size="13" fill="${QUIET}" opacity=".75">Then open it from Applications. It lives in the menu bar.</text>` +
    well(DMG.app) +
    well(DMG.applications) +
    `<path d="${arrow}" fill="none" stroke="url(#lit)" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" filter="url(#soft)" opacity=".9"/>` +
    `<path d="${arrow}" fill="none" stroke="url(#lit)" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>` +
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
