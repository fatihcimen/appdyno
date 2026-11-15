import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/** A sheet's custom properties, as `--name` to its value. */
const propsOf = (css: string) =>
  Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));

/** A sheet's two sets: what it says first, and that with what follows `at` laid over it. */
const setsOf = (file: string, at: string) => {
  const css = readFileSync(new URL(`../src/styles/${file}`, import.meta.url), 'utf8');
  const [first = '', second = ''] = css.split(at);
  assert.ok(second, `${file} has no ${at}`);
  return [propsOf(first), { ...propsOf(first), ...propsOf(second) }] as const;
};

const luminance = (hex: string) => {
  assert.match(hex, /^#[0-9a-f]{6}$/, `${hex} is not a plain colour`);
  const [r = 0, g = 0, b = 0] = [1, 3, 5]
    .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG's contrast ratio of two colours. */
const ratio = (a: string, b: string) => {
  const [dark = 0, light = 0] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
};

/** Holds each text colour to AA's 4.5:1 on each ground it is written on, in both sets of a sheet. */
const holds = (file: string, at: string, written: Record<string, string[]>) => {
  const [light, dark] = setsOf(file, at);
  const failed = [light, dark].flatMap((set, i) =>
    Object.entries(written).flatMap(([text, grounds]) =>
      grounds.flatMap((ground) => {
        const is = ratio(set[text] ?? text, set[ground] ?? ground);
        return is < 4.5
          ? [`${i ? 'second' : 'first'} set: ${text} on ${ground} is ${is.toFixed(2)}`]
          : [];
      }),
    ),
  );
  assert.deepEqual(failed, []);
};

test('the ratio is the one WCAG gives', () => {
  assert.equal(ratio('#000000', '#ffffff'), 21);
  assert.equal(ratio('#777777', '#ffffff').toFixed(2), '4.48');
});

test('every text of the landing page has 4.5:1 on its ground, light and dark', () => {
  holds('tokens.css', '@media (prefers-color-scheme: dark)', {
    // headings, body text, the install line, the cards
    '--fg': ['--floor', '--panel', '--term'],
    '--soft': ['--floor', '--panel', '--gauge-top', '--gauge-bottom'],
    // the nav, the footer, captions and notes, a step that is not the one playing
    '--muted': ['--floor', '--panel', '--term'],
    // links and code
    '--blue-lt': ['--floor', '--panel', '--term'],
    '--violet': ['--floor', '--panel'],
    '--magenta-lt': ['--floor', '--panel', '--term'],
    // the kicker, a step's number, a case's headings, a call's time
    '--amber': ['--floor', '--panel', '--term'],
    '--green': ['--term'],
    '--term-fg': ['--term'],
    // a button, a pressed chip and a ref's tag
    '--on-accent': ['--blue', '--app-buy', '--app-fg'],
    // the dial's numbers and unit on the lightest of its face, and its readout
    '--dial-ink': ['--dial-face'],
    '--dial-dim': ['--dial-face', '--dial-pit'],
    '--lcd-ink': ['--dial-pit'],
    // the example app on the phone
    '--app-fg': ['--app', '--app-card'],
    '--app-muted': ['--app-card'],
  });
});

test("every text of the docs has 4.5:1 on its ground, in Starlight's dark and light", () => {
  const text = ['--sl-color-white', '--sl-color-gray-1', '--sl-color-gray-2', '--sl-color-gray-3'];
  const [dark, light] = setsOf('docs.css', ":root[data-theme='light']");
  // Starlight's dark set is the first of the sheet: page and sidebar, with inline code on gray-5
  const grounds = [
    [
      dark,
      ['--sl-color-black', '--sl-color-gray-6'],
      '--sl-color-gray-5',
      '--sl-color-accent-high',
      '--sl-color-accent-low',
    ],
    [
      light,
      ['--sl-color-black', '--sl-color-gray-7'],
      '--sl-color-gray-6',
      '--sl-color-accent',
      '--sl-color-black',
    ],
  ] as const;
  for (const [set, pages, code, accent, onAccent] of grounds) {
    const is = (a: string, b: string) => ratio(set[a] ?? '', set[b] ?? '');
    for (const ground of pages) {
      for (const name of text) assert.ok(is(name, ground) >= 4.5, `${name} on ${ground}`);
      assert.ok(is(accent, ground) >= 4.5, `a link on ${ground}`);
    }
    assert.ok(is('--sl-color-white', code) >= 4.5, 'inline code');
    assert.ok(is(onAccent, accent) >= 4.5, 'the page of the sidebar that is open');
  }
});
