import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { must, NEEDS } from '@appdyno/core';
import { PERSON_HINTS, PERSON_REASONS } from '@appdyno/hub';
import { TRIED } from '../src/hub-services.js';

const viewer = join(import.meta.dirname, '../../../mac/Viewer');
const source = (file: string) => readFileSync(join(viewer, file), 'utf8');

const unquote = (s: string) => s.replace(/\\(.)/g, '$1');
const rows = [
  'WordsTable.m',
  'WordsClients.m',
  'WordsHelp.m',
  'WordsConnect.m',
  'WordsDevice.m',
  'WordsPanes.m',
]
  .flatMap((file) => [
    ...source(file).matchAll(/^\s*\{"((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\},$/gm),
  ])
  .map((m) => ({ en: unquote(must(m[1], 'its English')), tr: unquote(must(m[2], 'its Turkish')) }));
const english = new Set(rows.map((r) => r.en));
/** A word the table would find, as a pattern too. */
const known = (word: string) =>
  english.has(word) ||
  rows.some(
    (r) =>
      r.en.includes('%@') &&
      new RegExp(`^${r.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replaceAll('%@', '.+')}$`).test(
        word,
      ),
  );

describe('the table of words', () => {
  it('has each word once, and every word it has', () => {
    expect(rows.length).toBeGreaterThan(200);
    expect(rows.length).toBe(new Set(rows.map((r) => r.en)).size);
    expect(rows.filter((r) => !r.tr.trim())).toEqual([]);
  });

  it('keeps what changes: a Turkish row has as many places as its English', () => {
    const places = (s: string) => (s.match(/%(\d\$)?@/g) ?? []).length;
    expect(rows.filter((r) => places(r.en) !== places(r.tr))).toEqual([]);
  });

  it('numbers what changes where a row has two: each value keeps its own place', () => {
    const places = (s: string) => (s.match(/%(\d\$)?@/g) ?? []).length;
    expect(rows.filter((r) => places(r.tr) > 1 && !r.tr.includes('%1$@'))).toEqual([]);
  });

  it('writes Turkish with all its letters', () => {
    // words that lose their letters when typed on an English keyboard: none may stand plain
    const plain =
      /\b(cihaz[ıi]n[ıi] ac|goruntu|olcum|ayarlar[ıi] ac|kapali|baglan|sifre|cikis|acik)\b/i;
    expect(rows.filter((r) => plain.test(r.tr))).toEqual([]);
  });

  it('has every line that says what stands between a device and its picture', () => {
    const said = Object.values(NEEDS).flatMap((n) => [n.title, n.fix]);
    // commands stay as they are typed
    const words = said.filter((w) => !/^(xcode-select|xcrun) /.test(w));
    expect(words.filter((w) => !known(w))).toEqual([]);
  });

  it('has what a test of a client can say, and what to do next', () => {
    const said = Object.values(TRIED).flatMap((words) => [...words]);
    expect(said.filter((w) => w && !known(w))).toEqual([]);
  });

  it('has what doctor can say to do', () => {
    const fixes = [
      'set ANDROID_HOME to the Android SDK (Android only)',
      'accept the USB debugging prompt on the phone',
      'reconnect the cable, or restart the emulator',
    ];
    expect(fixes.filter((w) => !known(w))).toEqual([]);
  });

  it('has what the Performance pane says to do after a measure is refused, in the words it says it in', () => {
    expect([...PERSON_HINTS.values()].filter((w) => !known(w))).toEqual([]);
  });

  it('has why the Device pane cannot change a condition, in the words it says it in', () => {
    expect(PERSON_REASONS.map(([, words]) => words).filter((w) => !known(w))).toEqual([]);
  });

  it('has what a live reading says of a number it has not got', () => {
    const live = readFileSync(
      join(import.meta.dirname, '../../core/src/mirror/live-measured.ts'),
      'utf8',
    );
    const notes = [...live.matchAll(/(?:^const [A-Z_]+ = |allAbsent\([^,]+, )'([^']+)'/gm)].map(
      (m) => must(m[1], 'its note'),
    );
    expect(notes.length).toBeGreaterThanOrEqual(6);
    // the Performance pane begins a sentence with it; the cards say it as one goes on, and are found so too
    const begun = notes.map((n) => n.charAt(0).toUpperCase() + n.slice(1));
    expect(begun.filter((w) => !english.has(w))).toEqual([]);
  });

  it('has what the Logs and Network panes are told, and what a device says of a log and a capture', () => {
    const packages = join(import.meta.dirname, '../..');
    const quoted = (file: string, pattern: RegExp) =>
      [...readFileSync(join(packages, file), 'utf8').matchAll(pattern)].map((m) =>
        must(m[1] ?? m[2], file),
      );
    const sentence = /'([A-Z][^']* [^']*)'|"([A-Z][^"]* [^"]*)"/g;
    const said = [
      ...quoted('hub/src/window-logs.ts', sentence),
      ...quoted('hub/src/window-network.ts', sentence),
      ...quoted('driver-apple/src/network.ts', /note: '([^']+)'/g),
      ...quoted('driver-apple/src/logs.ts', /PHONE_LOGS_NOTE =\s*"([^"]+)"/g),
    ];
    expect(said.length).toBeGreaterThanOrEqual(10);
    expect(said.filter((w) => !known(w))).toEqual([]);
  });

  it("has what an iPhone's and a simulator's own audit says, as each has been seen", () => {
    const said = [
      'Contrast failed',
      'Contrast nearly passed',
      'Hit area is too small',
      'Text clipped',
    ];
    expect(said.filter((w) => !known(w))).toEqual([]);
  });

  it('has what a recording says in the bar, as it comes', () => {
    const said = [
      'Saved to the Desktop: 4 steps',
      'Saved to the Desktop: 4 steps, 1 to look at',
      'com.apple.springboard is in front: a replay must start there',
      'What is in front has no name: a replay must start there',
      'A measure restarts the app: stop the recording first',
      'Nothing was recorded',
    ];
    expect(said.filter((w) => !known(w))).toEqual([]);
  });

  it('keeps what an app or a device names as it came: no word of theirs passes through the table', () => {
    // a list draws a row's words as its builder gives them, an app's name and an element's label among them
    expect(source('List.m')).toMatch(/MVContentText\(row\.title \?: @"",/);
    expect(source('List.m')).toMatch(/MVContentText\(\[row\.detail /);
    // what the parent sends under these keys is an app's, a device's or an op's, with names in it
    const content =
      /MVWord\(\[?\w*\[@"(label|app|url|done|reason|detail|symbolicated|file|host|client|serial|model|name|error|at|message|note|line|text|hint|why)"\]/g;
    const files = readdirSync(viewer).filter((f) => f.endsWith('.m') && !f.startsWith('SelfTest'));
    expect(
      files.flatMap((f) => [...source(f).matchAll(content)].map((m) => `${f}: ${m[0]}`)),
    ).toEqual([]);
  });

  it('has every sentence of the client and help panes, in whatever shape they are kept', () => {
    const missed = ['HubClients.m', 'HubHelp.m', 'HubConnect.m', 'HubTools.m'].flatMap((file) =>
      [...source(file).matchAll(/@"([A-Z][^"]* [^"]*)"/g)]
        .map((m) => must(m[1], 'a sentence'))
        .filter((word) => !known(word))
        .map((word) => `${file}: ${word}`),
    );
    expect(missed).toEqual([]);
  });

  it('is what every control and label on a window says: nothing is written past it', () => {
    const shown =
      /(?:buttonWithTitle|addItemWithTitle|addButtonWithTitle|labelWithString|initWithTitle):@"([^"]+)"|(?:placeholderString|toolTip|accessibilityLabel|messageText|informativeText) = @"([^"]+)"|(?:MVText|MVWrappedText|MVPaneNote|MVPaneHeading|MVParagraph|MVFormat|MVPlaceButton|MVPlacePrimary|MVWord|caption|note|heading|line)\(@"([^"]+)"/g;
    const missed: string[] = [];
    for (const file of readdirSync(viewer).filter((f) => f.endsWith('.m'))) {
      if (file.startsWith('SelfTest') || file.startsWith('Words')) continue;
      for (const m of source(file).matchAll(shown)) {
        const word = must(m[1] ?? m[2] ?? m[3], 'a word');
        // a dash for a figure not read yet, and a name to type: no word to put in another language
        if (word.startsWith('\\u') || !/[a-z]{2}/i.test(word) || word === 'appdyno_emulator')
          continue;
        if (!known(word)) missed.push(`${file}: ${word}`);
      }
    }
    expect(missed).toEqual([]);
  });
});
