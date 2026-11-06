import { describe, expect, it } from 'vitest';
import {
  junitXml,
  parseFlow,
  runSteps,
  toMaestro,
  type Executor,
  type StepEvent,
} from '../src/index.js';

const flow = parseFlow(`app a.b
param P
tap id=one
type "\${P}"
assert id=two
`);

describe('running a flow', () => {
  const ok: Executor = { act: async () => ({ settledMs: 7, settled: true }) };

  it('runs in order, filling values, and shows the line, never the value', async () => {
    const seen: string[] = [];
    const r = await runSteps(
      flow,
      {
        act: async (st) => {
          seen.push(st.action === 'type' ? String(st.args.text) : st.action);
          return {};
        },
      },
      { values: { P: 'hidden' } },
    );
    expect(seen).toEqual(['tap', 'hidden', 'assert']);
    expect(r.passed).toBe(true);
    expect(JSON.stringify(r)).not.toContain('hidden');
    expect(r.steps[1]).toMatchObject({ n: 2, line: 4, step: 'type "${P}"' });
  });

  it('stops at the first failure with the step and the line', async () => {
    const seen: string[] = [];
    const r = await runSteps(flow, {
      act: async (st) => {
        seen.push(st.action);
        if (st.action === 'type') throw Object.assign(new Error('no field'), { code: 'NO_FOCUS' });
        return {};
      },
    });
    expect(seen).toEqual(['tap', 'type']);
    expect(r).toMatchObject({
      passed: false,
      failure: { n: 2, line: 4, message: 'no field', code: 'NO_FOCUS' },
    });
    expect(r.steps).toHaveLength(1);
  });

  it('resumes at a step', async () => {
    const seen: string[] = [];
    await runSteps(
      flow,
      {
        act: async (st) => {
          seen.push(st.action);
          return {};
        },
      },
      { from: 3 },
    );
    expect(seen).toEqual(['assert']);
  });

  it('calls onStep around the action, after its target came, with the settled time', async () => {
    const order: string[] = [];
    const events: StepEvent[] = [];
    const r = await runSteps(
      flow,
      {
        prepare: async () => void order.push('prepare'),
        act: async () => {
          order.push('act');
          return ok.act(flow.steps[0]!);
        },
      },
      {
        from: 3,
        onStep: async (e) => {
          order.push(e.phase);
          events.push(e);
        },
      },
    );
    expect(order).toEqual(['prepare', 'before', 'act', 'after']);
    const after = events[1]!;
    expect(after.phase === 'after' && after.result).toMatchObject({ n: 3, settledMs: 7 });
    expect(r.steps[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it('ends with the error of a hook that throws', async () => {
    await expect(
      runSteps(flow, ok, {
        onStep: () => {
          throw new Error('the measure broke');
        },
      }),
    ).resolves.toMatchObject({ failure: { message: 'the measure broke' } });
  });
});

describe('Maestro export', () => {
  const yaml = (body: string) => toMaestro(parseFlow(`app dev.x\n${body}\n`));

  it('writes the supported steps', () => {
    expect(
      yaml(`launch
tap id=submit
tap text="Sent (1) $5"
type "hi" id=name_input
press_key back
press_key enter
swipe up
scroll_to text="Row" direction=up
wait_for id=loaded timeoutMs=8000
assert text="Yes"
assert text="No" check=absent
assert id=r check=text equals="a.b"
assert id=s check=enabled expect=false
open_link "app://x"
set_location 41 29
hide_keyboard
stop`),
    ).toBe(`appId: "dev.x"
---
- launchApp:
    stopApp: false
- tapOn:
    id: "submit"
- tapOn:
    text: "Sent \\\\(1\\\\) \\\\$5"
- tapOn:
    id: "name_input"
- inputText: "hi"
- back
- pressKey: "Enter"
- swipe:
    direction: "UP"
- scrollUntilVisible:
    element:
      text: "Row"
    direction: "DOWN"
- extendedWaitUntil:
    visible:
      id: "loaded"
    timeout: 8000
- assertVisible:
    text: "Yes"
- assertNotVisible:
    text: "No"
- assertVisible:
    id: "r"
    text: "a\\\\.b"
- assertVisible:
    id: "s"
    enabled: false
- openLink: "app://x"
- setLocation:
    latitude: "41"
    longitude: "29"
- hideKeyboard
- stopApp
`);
  });

  it('takes a check given time to hold as a wait', () => {
    expect(yaml('assert id=a timeoutMs=800')).toContain(
      '- extendedWaitUntil:\n    visible:\n      id: "a"\n    timeout: 800\n',
    );
    expect(yaml('assert id=a check=absent timeoutMs=800')).toContain('notVisible:');
  });

  it('leaves placeholders for Maestro to fill, and says what it could not keep', () => {
    const out = toMaestro(
      parseFlow('app a\nsecret S\ntype "${S}"\ntap text="x ${S}."\ntap role=button text="B"\n'),
    );
    expect(out).toContain('inputText: "${S}"');
    expect(out).toContain('text: "x ${S}\\\\."');
    expect(out).toContain('# step 3: role=button left out');
  });

  it('refuses, naming each step it has no form for', () => {
    const fails = (body: string, says: RegExp) => expect(() => yaml(body)).toThrow(says);
    fails('launch\nalert allow', /step 2 \(line 3, alert\)/);
    fails('tap x=1 y=2 !coordinates', /step 1 .*coordinates/);
    fails('type "x" replace', /step 1 .*whole field/);
    fails('tap role=button', /step 1 .*role alone/);
    fails('press_key app_switch', /step 1 .*app_switch/);
    fails('swipe up distance=300', /step 1 .*distance/);
    fails('scroll_to text="x" maxSwipes=3', /step 1 .*maxSwipes/);
    fails('type "cost $${A}"', /step 1 .*literal/);
    fails('assert id=r check=text equals="a" timeoutMs=9', /step 1 .*timeoutMs/);
    fails('assert id=r check=moves', /step 1 .*what moves/);
    fails('assert text="x" check=moves', /step 1 .*what moves/);
    fails('unrecorded "gesture pinch"', /step 1 .*gesture pinch/);
    expect(() => yaml('alert allow\nlaunch\nunrecorded "x"')).toThrow(/step 1[^]*step 3/);
    expect(() => toMaestro(parseFlow('launch'))).toThrow(/needs an app/);
    expect(toMaestro(parseFlow('app dev.x\ntag smoke login\nlaunch\n'))).toContain(
      'appId: "dev.x"\ntags:\n  - smoke\n  - login\n---\n',
    );
  });
});

describe('JUnit', () => {
  it('counts, times, and escapes what would break the file', () => {
    const xml = junitXml([
      {
        name: 'emulator-5554',
        cases: [
          { name: 'a.flow', ms: 1500, out: '1. tap id=x: settled in 200 ms' },
          {
            name: 'b<&>.flow',
            ms: 250,
            failure: { message: 'no "x" <here> & \u0007there', detail: 'line 1\nline 2 <b>' },
          },
        ],
      },
    ]);
    expect(xml).toContain('<testsuites tests="2" failures="1" errors="0" time="1.750">');
    expect(xml).toContain('<testsuite name="emulator-5554" tests="2" failures="1"');
    expect(xml).toContain('<testcase name="a.flow" classname="emulator-5554" time="1.500">');
    expect(xml).toContain('name="b&lt;&amp;&gt;.flow"');
    expect(xml).toContain('message="no &quot;x&quot; &lt;here&gt; &amp; there"');
    expect(xml).toContain('line 2 &lt;b&gt;</failure>');
    expect(xml).toContain('<system-out>1. tap id=x: settled in 200 ms</system-out>');
    expect(xml).not.toContain('\u0007');
  });
});
