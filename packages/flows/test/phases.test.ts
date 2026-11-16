import { describe, expect, it } from 'vitest';
import {
  composeFlow,
  flowText,
  parseFlow,
  runSteps,
  stepLine,
  toMaestro,
  valuesFor,
  type Executor,
} from '../src/index.js';

/** A flow's files by absolute path. */
const loader = (texts: Record<string, string>) => (path: string) => {
  const text = texts[path];
  if (text === undefined) throw new Error(`no ${path}`);
  return parseFlow(text);
};

describe('the files a setup and a teardown come from', () => {
  const texts = {
    '/p/_setup.flow': 'app x\nlaunch\n',
    '/p/_teardown.flow': 'stop\n',
    '/p/shop/_setup.flow': 'secret PASSWORD\ntype "${PASSWORD}" id=password\n',
    '/p/shop/_teardown.flow': 'tap id=sign_out\n',
    '/p/shop/pay.flow': 'setup own/cart.flow\nteardown own/empty.flow\ntap id=pay\n',
    '/p/shop/own/cart.flow': 'run add.flow\n',
    '/p/shop/own/add.flow': 'tap id=add\n',
    '/p/shop/own/empty.flow': 'tap id=empty\n',
  };
  const shared = {
    setup: ['/p/_setup.flow', '/p/shop/_setup.flow'],
    teardown: ['/p/shop/_teardown.flow', '/p/_teardown.flow'],
  };

  it("runs the folders' setup outermost first then its own, and its own teardown before the folders'", () => {
    const flow = composeFlow('/p/shop/pay.flow', loader(texts), shared);
    expect(flow.steps.map(stepLine)).toEqual(['tap id=pay']);
    expect(flow.setup?.map((s) => [stepLine(s), s.file, s.line])).toEqual([
      ['launch', '/p/_setup.flow', 2],
      ['type "${PASSWORD}" id=password', '/p/shop/_setup.flow', 2],
      ['tap id=add', '/p/shop/own/add.flow', 1],
    ]);
    expect(flow.teardown?.map(stepLine)).toEqual(['tap id=empty', 'tap id=sign_out', 'stop']);
    expect(flow).toMatchObject({ app: 'x', secrets: ['PASSWORD'] });
    expect(() => valuesFor(flow, {}, {})).toThrow('no value for PASSWORD');
  });

  it('has neither where no file names one, and writes its own lines back', () => {
    const flow = composeFlow('/p/shop/own/add.flow', loader(texts));
    expect(flow.setup).toBeUndefined();
    expect(flow.teardown).toBeUndefined();
    const text = 'setup "my flows/in.flow"\nteardown out.flow\n\nlaunch\n';
    expect(flowText(parseFlow(text))).toBe(text);
  });

  it('refuses two of one, one after the steps, one that is no flow, and one for another app', () => {
    expect(() => parseFlow('setup a.flow\nsetup b.flow\nlaunch\n')).toThrow('line 2: one setup');
    expect(() => parseFlow('launch\nteardown a.flow\n')).toThrow('teardown comes before');
    expect(() => parseFlow('setup a.sh\nlaunch\n')).toThrow('line 1: setup names a .flow file');
    const load = loader({
      '/f/a.flow': 'app one\nsetup b.flow\nlaunch\n',
      '/f/b.flow': 'app two\nlaunch\n',
    });
    expect(() => composeFlow('/f/a.flow', load)).toThrow('/f/b.flow is for two, this flow for one');
  });

  it('refuses a setup that runs the flow it is the start of, and an export that would drop one', () => {
    const load = loader({ '/f/a.flow': 'setup b.flow\nlaunch\n', '/f/b.flow': 'run a.flow\n' });
    expect(() => composeFlow('/f/a.flow', load)).toThrow('a flow cannot run itself');
    const flow = composeFlow('/p/shop/pay.flow', loader(texts), shared);
    expect(() => toMaestro(flow)).toThrow('its setup and teardown have no form there');
  });
});

describe('a run with a setup and a teardown', () => {
  const step = (text: string) => parseFlow(`${text}\n`).steps;
  const whole = {
    ...parseFlow('tap id=one\ntap id=two\n'),
    setup: step('launch'),
    teardown: [...step('tap id=clear'), ...step('stop')],
  };
  /** Runs it with the steps named failing, and says what ran. */
  const ran = async (failing: string[], from = 1) => {
    const seen: string[] = [];
    const events: string[] = [];
    const r = await runSteps(
      whole,
      {
        act: (st) => {
          const line = `${st.action}${st.selector?.id ? ` ${st.selector.id}` : ''}`;
          seen.push(line);
          return failing.includes(line)
            ? Promise.reject(new Error(`no ${line}`))
            : Promise.resolve({});
        },
      },
      {
        from,
        onStep: (e) => void events.push(`${e.phase} ${e.step.action}`),
        onFailure: (f) => void seen.push(`failed ${f.step}`),
      },
    );
    return { r, seen, events };
  };

  it('runs the setup, the steps, then the teardown, and measures only the steps', async () => {
    const { r, seen, events } = await ran([]);
    expect(seen).toEqual(['launch', 'tap one', 'tap two', 'tap clear', 'stop']);
    expect(events).toEqual(['before tap', 'after tap', 'before tap', 'after tap']);
    expect(r).toMatchObject({ passed: true, teardown: { ok: true, failed: [] } });
    expect(r.setup).toMatchObject([{ n: 1, phase: 'setup', step: 'launch' }]);
    expect(r.steps.map((x) => x.n)).toEqual([1, 2]);
    expect(r.teardown?.steps.map((x) => [x.n, x.phase])).toEqual([
      [1, 'teardown'],
      [2, 'teardown'],
    ]);
  });

  it('runs the teardown after a failed step, once the failure was seen as it was', async () => {
    const { r, seen } = await ran(['tap one']);
    expect(seen).toEqual(['launch', 'tap one', 'failed tap id=one', 'tap clear', 'stop']);
    expect(r).toMatchObject({ passed: false, failure: { n: 1, step: 'tap id=one' } });
    expect(r.failure?.phase).toBeUndefined();
    expect(r.teardown?.ok).toBe(true);
  });

  it('runs no step of the flow after a failed setup, and the teardown all the same', async () => {
    const { r, seen } = await ran(['launch']);
    expect(seen).toEqual(['launch', 'failed launch', 'tap clear', 'stop']);
    expect(r).toMatchObject({ passed: false, steps: [], failure: { phase: 'setup', n: 1 } });
  });

  it('runs every step of a teardown, and keeps its failures apart from a pass', async () => {
    const { r, seen } = await ran(['tap clear']);
    expect(seen).toEqual(['launch', 'tap one', 'tap two', 'tap clear', 'stop']);
    expect(r.passed).toBe(true);
    expect(r.failure).toBeUndefined();
    expect(r.teardown).toMatchObject({
      ok: false,
      steps: [{ step: 'stop' }],
      failed: [{ phase: 'teardown', n: 1, message: 'no tap clear' }],
    });
  });

  it('leaves the first failure as it is when the teardown fails too', async () => {
    const { r } = await ran(['tap two', 'stop']);
    expect(r.failure).toMatchObject({ n: 2, message: 'no tap two' });
    expect(r.teardown?.failed).toMatchObject([{ n: 2, message: 'no stop' }]);
  });

  it('runs the setup before a step it goes on from', async () => {
    expect((await ran([], 2)).seen).toEqual(['launch', 'tap two', 'tap clear', 'stop']);
  });
});

describe('a prepare step', () => {
  it('asks for no value it gives before that is used, in the order a run takes', () => {
    const flow = parseFlow('param A\nparam B\nprepare seed gives=A\ntype "${A} ${B}"\n');
    expect(valuesFor(flow, { B: 'b' }, {})).toEqual({ B: 'b' });
    const late = parseFlow('param A\ntype "${A}"\nprepare seed gives=A\n');
    expect(() => valuesFor(late, {}, {})).toThrow('no value for A');
    const setup = parseFlow('secret T\nprepare token gives=T\n').steps;
    expect(valuesFor({ ...parseFlow('secret T\ntype "${T}"\n'), setup }, {}, {})).toEqual({});
    expect(() => parseFlow('prepare seed gives=A\n')).toThrow('${A} is not declared');
    expect(() => parseFlow('prepare seed gives=a\n')).toThrow('like MY_NAME');
    expect(flowText(flow)).toContain('prepare seed gives=A\n');
  });

  it('gives its values to the steps after it, and fails a step whose value never came', async () => {
    const flow = {
      ...parseFlow('param WHO\ntype "${WHO}"\n'),
      setup: parseFlow('param WHO\nprepare seed gives=WHO\n').steps,
      teardown: parseFlow('param WHO\ntype "bye ${WHO}"\n').steps,
    };
    const typed: string[] = [];
    const exec = (gives: boolean): Executor => ({
      act: (st) => {
        if (st.action === 'type') typed.push(String(st.args.text));
        if (st.action !== 'prepare') return Promise.resolve({});
        return gives
          ? Promise.resolve({ values: { WHO: 'Ada' } })
          : Promise.reject(new Error('exit 1'));
      },
    });
    const r = await runSteps(flow, exec(true));
    expect(typed).toEqual(['Ada', 'bye Ada']);
    expect(JSON.stringify(r)).not.toContain('Ada');
    typed.length = 0;
    const failed = await runSteps(flow, exec(false));
    expect(typed).toEqual([]);
    expect(failed.failure).toMatchObject({ phase: 'setup', message: 'exit 1' });
    expect(failed.teardown?.failed[0]?.message).toContain('no value for WHO');
  });
});
