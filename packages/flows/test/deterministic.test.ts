import { describe, expect, it } from 'vitest';
import {
  composeFlow,
  flowText,
  parseFlow,
  runSteps,
  stepLine,
  toMaestro,
  valuesFor,
} from '../src/index.js';

describe('a step for one platform', () => {
  const TEXT = `param CODE
launch
only ios tap text="Allow Once"
only android
  press_key back
  type "\${CODE}" id=code
end
assert id=home
`;

  it('reads one line or a block, and writes each step back with its platform', () => {
    const flow = parseFlow(TEXT);
    expect(flow.steps.map((s) => [s.action, s.only, s.line])).toEqual([
      ['launch', undefined, 2],
      ['tap', 'ios', 3],
      ['press_key', 'android', 5],
      ['type', 'android', 6],
      ['assert', undefined, 8],
    ]);
    const written = flowText(flow);
    expect(written).toContain('only ios tap text="Allow Once"\nonly android press_key back\n');
    expect(parseFlow(written)).toEqual({
      ...flow,
      steps: flow.steps.map((s) => ({ ...s, line: expect.any(Number) as number })),
    });
  });

  it('refuses another platform, a block in a block, one left open, and a line that is no step', () => {
    expect(() => parseFlow('only windows tap id=x\n')).toThrow('line 1: only takes ios or android');
    expect(() => parseFlow('only ios\nonly android tap id=x\nend\n')).toThrow(
      'line 2: this is inside the only ios of line 1',
    );
    expect(() => parseFlow('launch\nonly ios\ntap id=x\n')).toThrow(
      'line 2: only ios is not closed',
    );
    expect(() => parseFlow('launch\nend\n')).toThrow('line 2: end closes an only block');
    expect(() => parseFlow('only ios id=x\n')).toThrow('only ios is followed by a step');
    expect(() => parseFlow('only ios\ntag smoke\nend\nlaunch\n')).toThrow('tag comes before');
  });

  it('skips a step of the other platform, with no value asked for it and nothing done', async () => {
    const flow = parseFlow(TEXT);
    expect(valuesFor(flow, {}, {}, 1, 'ios')).toEqual({});
    expect(() => valuesFor(flow, {}, {}, 1, 'android')).toThrow('no value for CODE');
    const seen: string[] = [];
    const r = await runSteps(
      flow,
      { act: (st) => Promise.resolve(void seen.push(st.action)).then(() => ({})) },
      { platform: 'ios', onStep: (e) => void seen.push(e.phase) },
    );
    expect(seen).toEqual([
      'before',
      'launch',
      'after',
      'before',
      'tap',
      'after',
      'before',
      'assert',
      'after',
    ]);
    expect(r.passed).toBe(true);
    expect(r.steps.map((s) => [s.n, s.skipped])).toEqual([
      [1, undefined],
      [2, undefined],
      [3, 'android only'],
      [4, 'android only'],
      [5, undefined],
    ]);
  });

  it('keeps a file run for one platform to it, and refuses one that holds the other', () => {
    const load = (texts: Record<string, string>) => (path: string) => parseFlow(texts[path] ?? '');
    const flow = composeFlow(
      '/f/a.flow',
      load({ '/f/a.flow': 'launch\nonly android run b.flow\n', '/f/b.flow': 'tap id=x\n' }),
    );
    expect(flow.steps.map(stepLine)).toEqual(['launch', 'only android tap id=x']);
    const both = load({
      '/f/a.flow': 'only android run b.flow\n',
      '/f/b.flow': 'launch\nonly ios tap id=x\n',
    });
    expect(() => composeFlow('/f/a.flow', both)).toThrow(
      '/f/a.flow:1: /f/b.flow is run for android alone, and its line 2 is for ios',
    );
  });
});

describe('the checks a run makes itself', () => {
  it('reads a count, a clipboard and an audit, and writes them back', () => {
    const text = [
      'assert role=cell check=count equals=3',
      'assert id=row check=count min=1 max=20 timeoutMs=500',
      'clipboard "TR33 0006"',
      'clipboard equals="TR33 0006"',
      'clipboard contains=0006 timeoutMs=2000',
      'audit',
      'audit types="contrast,hitRegion" max=2',
      '',
    ].join('\n');
    expect(flowText(parseFlow(text))).toBe(text);
    expect(parseFlow('audit types=contrast,hitRegion\n').steps[0]?.args.types).toBe(
      'contrast,hitRegion',
    );
  });

  it('refuses a count with an index, with no number or with both forms, and a range on another check', () => {
    const no = (line: string, why: string) => expect(() => parseFlow(`${line}\n`)).toThrow(why);
    no('assert id=row index=1 check=count equals=3', 'counts every match: no index');
    no('assert id=row check=count', 'takes equals=3, or min= and max=');
    no('assert id=row check=count equals=3 min=1', 'one or the other');
    no('assert id=row check=count equals=three', 'equals is a count: three');
    no('assert id=row check=count min=1.5', 'min and max are whole numbers');
    no('assert id=row check=count equals=3 expect=false', 'takes no expect');
    no('assert id=row min=1', 'min and max are for check=count');
    no('assert id=row check=count equals=3 timeoutMs=60000', 'timeoutMs is 0 to 15000');
    expect(parseFlow('param N\nassert id=row check=count equals="${N}"\n').steps).toHaveLength(1);
  });

  it('refuses a clipboard line that neither puts nor checks, or does both, and a threshold that is no count', () => {
    const no = (line: string, why: string) => expect(() => parseFlow(`${line}\n`)).toThrow(why);
    no('clipboard', 'a text to put there, or equals= or contains=');
    no('clipboard "a" equals="a"', 'one of them');
    no('clipboard "a" timeoutMs=100', 'timeoutMs is for a check');
    no('audit max=-1', 'max is a whole number');
  });

  it('exports none of them as something else', () => {
    const lines = ['only ios launch', 'assert id=r check=count equals=1', 'clipboard "a"', 'audit'];
    const said = () => toMaestro(parseFlow(`app a.b\n${lines.join('\n')}\n`));
    expect(said).toThrow(/step 1 .*for ios alone/);
    expect(said).toThrow(/step 2 .*no count/);
    expect(said).toThrow(/step 3 .*clipboard/);
    expect(said).toThrow(/step 4 .*audit/);
  });
});
