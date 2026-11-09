import { assert, describe, expect, it } from 'vitest';
import {
  escapeLiteral,
  fillStep,
  flowText,
  FlowError,
  parseFlow,
  valuesFor,
  type Flow,
} from '../src/index.js';

const SAMPLE = `# a sign-in
app dev.appdyno.fixture
param NAME
secret PASSWORD_INPUT

launch
tap role=button text="Form"   # opens the form
type "\${NAME}" id=name_input replace
type "\${PASSWORD_INPUT}" id=password_input submit
press_key back
swipe up
scroll_to text="Ürün 25" direction=down maxSwipes=20
wait_for id=loaded timeoutMs=8000
wait_for text="Spinner" gone
assert id=result check=text equals="Sent: \${NAME}"
assert id=submit check=enabled expect=false
tap id=add_button index=2 !ambiguous
tap x=540 y=1200 screen=1080x2400 !coordinates
open_link "appdyno-fixture://open/form?a=1&b=2"
set_location 41.0082 28.9784
alert allow
hide_keyboard
launch language=pt-BR
launch arg=-UITests arg=YES env="API_URL=https://a.example/x y"
stop
`;

describe('the flow format', () => {
  it('reads every step with its line, past comments and blank lines', () => {
    const f = parseFlow(SAMPLE);
    expect(f.app).toBe('dev.appdyno.fixture');
    expect(f.params).toEqual(['NAME']);
    expect(f.secrets).toEqual(['PASSWORD_INPUT']);
    expect(f.steps[0]).toMatchObject({ action: 'launch', line: 6 });
    expect(f.steps[1]).toMatchObject({
      action: 'tap',
      line: 7,
      selector: { role: 'button', text: 'Form' },
    });
    expect(f.steps[2]).toMatchObject({ args: { text: '${NAME}', replace: true } });
    expect(f.steps.find((s) => s.action === 'set_location')?.args).toEqual({
      lat: 41.0082,
      lon: 28.9784,
    });
    expect(f.steps.find((s) => s.flags.includes('ambiguous'))?.selector?.index).toBe(2);
    expect(f.steps.filter((s) => s.action === 'launch').map((s) => s.args)).toEqual([
      {},
      { language: 'pt-BR' },
      { arg: ['-UITests', 'YES'], env: ['API_URL=https://a.example/x y'] },
    ]);
  });

  it('writes what it reads back, step for step', () => {
    const once = parseFlow(SAMPLE);
    const again = parseFlow(flowText(once));
    const body = (f: Flow) => f.steps.map(({ line: _line, ...rest }) => rest);
    expect(body(again)).toEqual(body(once));
    expect(flowText(again)).toBe(flowText(once));
  });

  it('keeps Unicode, quotes and escapes through a round trip', () => {
    const text = 'Ayşe "İstanbul"\nikinci satır \\ son';
    const f: Flow = {
      tags: [],
      params: [],
      secrets: [],
      steps: [{ action: 'type', line: 0, args: { text }, flags: [] }],
    };
    const back = parseFlow(flowText(f));
    expect(back.steps[0]?.args.text).toBe(text);
    expect(flowText(f)).toContain('İstanbul');
  });

  it('reads tags on one line or several, and writes them back', () => {
    const f = parseFlow('app dev.app\ntag smoke login\ntag nightly\n\nlaunch\n');
    expect(f.tags).toEqual(['smoke', 'login', 'nightly']);
    expect(flowText(f)).toContain('app dev.app\ntag smoke login nightly\n\nlaunch\n');
    expect(parseFlow(flowText(f)).tags).toEqual(f.tags);
    expect(parseFlow('tag only\nlaunch\n').steps).toHaveLength(1);
    expect(flowText(parseFlow('tag only\nlaunch\n'))).toBe('tag only\n\nlaunch\n');
    expect(parseFlow('launch\n').tags).toEqual([]);
  });

  it('refuses a tag after the steps, or one that is no word', () => {
    expect(() => parseFlow('launch\ntag late\n')).toThrow('line 2: tag comes before the steps');
    expect(() => parseFlow('tag\nlaunch\n')).toThrow('line 1: tag takes words');
    expect(() => parseFlow('tag a=b\nlaunch\n')).toThrow('line 1: tag takes words');
    expect(() => parseFlow('tag smoke,login\nlaunch\n')).toThrow('line 1: tag takes words');
  });

  it('refuses what it cannot run, saying the line', () => {
    const bad = (text: string, says: RegExp, line: number) => {
      let err: unknown;
      try {
        parseFlow(text);
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(FlowError);
      expect((err as FlowError).line).toBe(line);
      expect((err as FlowError).message).toMatch(says);
    };
    bad('launch\nfly high', /no step fly/, 2);
    bad('tap ref=@k3f9', /a ref names an element for one session/, 1);
    bad('tap', /needs a target/, 1);
    bad('tap x=1 y=2', /!coordinates/, 1);
    bad('tap x=1 !coordinates', /give x and y/, 1);
    bad('tap id=a x=1 y=2 !coordinates', /not both/, 1);
    bad('tap index=1', /an index needs/, 1);
    bad('tap id=a nope=1', /tap has no nope/, 1);
    bad('tap id=a !huh', /no flag !huh/, 1);
    bad('launch env=API_URL', /env is NAME=value/, 1);
    bad('type', /type needs text/, 1);
    bad('set_location 41 east', /lon needs a number/, 1);
    bad('tap text="open', /not closed/, 1);
    bad('launch\napp x', /comes before the steps/, 2);
    bad('secret lower\nlaunch', /names are like/, 1);
    bad('param A\nsecret A\nlaunch', /declared twice/, 2);
    bad('\n\ntype "${NOPE}"', /\$\{NOPE\} is not declared/, 3);
    bad('type "${lower}"', /no such placeholder/, 1);
    expect(() => parseFlow('# nothing\n')).toThrow(/at least one step/);
  });
});

describe('parameters', () => {
  const flow = parseFlow('param A\nsecret B\ntap id=x\ntype "${A}-${B}"\n');

  it('fills from --param first, then the environment', () => {
    expect(valuesFor(flow, { A: 'from-param' }, { A: 'env', B: 'env-b' })).toEqual({
      A: 'from-param',
      B: 'env-b',
    });
    const [, typed] = flow.steps;
    assert(typed);
    expect(fillStep(typed, { A: '1', B: '2' }).args.text).toBe('1-2');
  });

  it('names a missing one and never a value', () => {
    expect(() => valuesFor(flow, { A: 'shown-nowhere' }, {})).toThrow(/no value for B/);
    expect(() => valuesFor(flow, { A: 'shown-nowhere' }, {})).not.toThrow(/shown-nowhere/);
  });

  it('asks only for what the steps from --from on use', () => {
    const later = parseFlow('param A\nparam B\ntype "${A}"\ntype "${B}"\n');
    expect(valuesFor(later, {}, { B: 'b' }, 2)).toEqual({ B: 'b' });
  });

  it('takes $${ as a literal ${, which a typed text may hold', () => {
    const typed = 'costs ${PRICE} today';
    const f = parseFlow(`type ${JSON.stringify(escapeLiteral(typed))}\n`);
    const [step] = f.steps;
    assert(step);
    expect(step.args.text).toBe('costs $${PRICE} today');
    expect(fillStep(step, {}).args.text).toBe(typed);
  });
});
