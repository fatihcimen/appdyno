import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RENAMED_NAMES } from '@appdyno/ops';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const name = `(?:\`(?:${RENAMED_NAMES.join('|')})\`|(?:${RENAMED_NAMES.join('|')})(?![\\w\`'’-]))`;
/** Where a clause begins: what follows is its subject, not a word after an article or an adjective. */
const clause = `(?:^|[:;,.(!?]\\s+|^\\s*[-*]\\s+|\\b(?:and|or|then|but|so)\\s+)`;
const VERBS =
  'says|has|reads|gives|lists|takes|works|uses|answers|returns|tells|wakes|shows|is now|sends|starts|stops|opens|closes|sets|finds|keeps';

/**
 * A name tools had before 1.3.0, used as a tool: the subject of a clause with what a tool does ("and crashes has the
 * whole report", "screen reads it"), "the simulator tool", or a call of one in backticks. Most of those names are plain
 * words too, and stay so after an article or an adjective ("a still screen reads nothing") and after a key ("source
 * crashes"); a name that is a flow step, a value or a command keeps it.
 */
const AS_TOOL = new RegExp(
  [
    `${clause}${name} (?:${VERBS})\\b`,
    `(?:${clause}|\\bthe\\s+)${name} tool\\b`,
    `\\b(?:call|use|try|run)\\s+\`(?:${RENAMED_NAMES.join('|')})\``,
  ].join('|'),
  'gm',
);
const asTool = (text: string) => [...text.matchAll(AS_TOOL)].map((m) => m[0]);

/** The words of a flow's steps, which a step keeps whatever the tools are called. */
const STEP_WORDS = new Set(['set_location', 'wait_for', 'double_tap', 'long_press', 'scroll_to']);
/** A name of then that is no word, and no step: in words, it was only ever a tool. */
const NEVER = new RegExp(
  `(?<![\\w-])(?:${RENAMED_NAMES.filter((n) => n.includes('_') && !STEP_WORDS.has(n)).join('|')})(?![\\w-])`,
);
/** The library's own words name its methods, of which `logs`, `screenshot` and `audit` share a name with a tool of then. */
const LIBRARY =
  /^(packages\/appdyno\/src\/device-members\.ts|docs\/reference\/library(\.tr)?\.md)$/;
// a changelog is what was true then, and the upgrade guide says the old names to say what takes their place
const HISTORY = /^(CHANGELOG(\.tr)?\.md|docs\/guides\/upgrade-1\.3(\.tr)?\.md)$/;

/** Each string a TypeScript file holds, by its line: what a model, a person or a page is told is among them. */
function stringsOf(file: string, text: string): [string, string][] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found: [string, string][] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isTemplateLiteralToken(n)) {
      const line = source.getLineAndCharacterOfPosition(n.getStart()).line + 1;
      found.push([`${file}:${String(line)}`, n.text]);
    }
    ts.forEachChild(n, visit);
  };
  visit(source);
  return found;
}

/** Each quoted string of a native file, by its line: the Mac app's words, and what an agent or a runner answers. */
const quotedIn = (file: string, text: string): [string, string][] =>
  [...text.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => [
    `${file}:${String(text.slice(0, m.index).split('\n').length)}`,
    m[1] ?? '',
  ]);

/** Each line of a page, code blocks too: a page quotes what a tool answers. */
const linesOf = (file: string, text: string): [string, string][] =>
  text.split('\n').map((line, i) => [`${file}:${String(i + 1)}`, line]);

function told(file: string): [string, string][] {
  if (LIBRARY.test(file) || HISTORY.test(file)) return [];
  const text = () => readFileSync(join(root, file), 'utf8');
  if (/^packages\/[^/]+\/src\/.*\.ts$/.test(file)) return stringsOf(file, text());
  if (/^(mac|ios|android)\/.*\.(m|h|swift|kt|java)$/.test(file)) return quotedIn(file, text());
  if (file.endsWith('.md') || /^site\/src\/.*\.(ts|astro)$/.test(file))
    return linesOf(file, text());
  return [];
}

describe('a name tools had before 1.3.0', () => {
  it('is no tool in what a model, a person or a page is told', () => {
    const said = tracked.flatMap(told);
    expect(said.length).toBeGreaterThan(10_000);
    const named = said.flatMap(([where, text]) => asTool(text).map((m) => `${where}: ${m}`));
    expect(named).toEqual([]);
    // a bare name is an op's part or a kept field, and only words are held to it
    const bare = said.filter(([, text]) => /\s/.test(text) && NEVER.test(text));
    expect(bare.map(([where]) => where)).toEqual([]);
  });

  it('is seen as a tool where it is one, and left as a word where it is a word', () => {
    expect(asTool('launch_app starts it again, and crashes has the whole report')).toHaveLength(1);
    expect(asTool('The system log is in Console.app; crashes works here.')).toHaveLength(1);
    expect(asTool('not in these views: screen reads it')).toHaveLength(1);
    expect(asTool('screen wakes it and reads what is there')).toHaveLength(1);
    expect(asTool('boot the emulator with the simulator tool')).toHaveLength(1);
    expect(asTool('call `find` with a selector')).toHaveLength(1);
    expect(asTool('read_logs with source crashes says why it died')).toEqual([]);
    expect(asTool('a still screen reads nothing, as a new simulator has no other app')).toEqual([]);
    expect(asTool('`read_logs` with `source: crashes` gives them')).toEqual([]);
    expect(asTool('`simctl push` takes no topic; `appdyno mirror` opens a window')).toEqual([]);
    expect(asTool('Steps cannot be taken back in the pane')).toEqual([]);
    expect(NEVER.test('perf_launch measures a cold start')).toBe(true);
    expect(NEVER.test('a step scroll_to holds on any screen; npx react-native start')).toBe(false);
  });
});
