import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NEEDS } from '@appdyno/core';
import { TRIED } from '../src/hub-places.js';

const viewer = join(import.meta.dirname, '../../../mirror/Viewer');
const source = (file: string) => readFileSync(join(viewer, file), 'utf8');

const unquote = (s: string) => s.replace(/\\(.)/g, '$1');
const rows = ['WordsTable.m', 'WordsClients.m', 'WordsHelp.m', 'WordsConnect.m']
  .flatMap((file) => [
    ...source(file).matchAll(/^\s*\{"((?:[^"\\]|\\.)*)", "((?:[^"\\]|\\.)*)"\},$/gm),
  ])
  .map((m) => ({ en: unquote(m[1]!), tr: unquote(m[2]!) }));
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

  it('has every sentence of the client and help panes, in whatever shape they are kept', () => {
    const missed = ['HubClients.m', 'HubHelp.m', 'HubConnect.m', 'HubTools.m'].flatMap((file) =>
      [...source(file).matchAll(/@"([A-Z][^"]* [^"]*)"/g)]
        .map((m) => m[1]!)
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
        const word = (m[1] ?? m[2] ?? m[3])!;
        // a dash for a figure not read yet, and a name to type: no word to put in another language
        if (word.startsWith('\\u') || !/[a-z]{2}/i.test(word) || word === 'appdyno_emulator')
          continue;
        if (!known(word)) missed.push(`${file}: ${word}`);
      }
    }
    expect(missed).toEqual([]);
  });
});
