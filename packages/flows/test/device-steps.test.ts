import { describe, expect, it } from 'vitest';
import { flowText, maskOf, maskText, parseFlow, toMaestro, type Flow } from '../src/index.js';

const STEPS = `screenshot home
visual home
visual checkout tolerance=0.5 mask="id=clock" mask="role=image text=\\"Map\\"" mask=0,600,1080,200
setting dark_mode on
setting text_size accessibility-large
setting locale tr-TR app=org.example
setting sms "Your code is 1234" title=5551234
setting restore
`;

describe('screenshot, visual and setting steps', () => {
  it('reads each with its words, numbers and masks', () => {
    const f = parseFlow(STEPS);
    expect(f.steps.map((s) => [s.action, s.args])).toEqual([
      ['screenshot', { name: 'home' }],
      ['visual', { name: 'home' }],
      [
        'visual',
        {
          name: 'checkout',
          tolerance: 0.5,
          mask: ['id=clock', 'role=image text="Map"', '0,600,1080,200'],
        },
      ],
      ['setting', { name: 'dark_mode', value: 'on' }],
      ['setting', { name: 'text_size', value: 'accessibility-large' }],
      ['setting', { name: 'locale', value: 'tr-TR', app: 'org.example' }],
      ['setting', { name: 'sms', value: 'Your code is 1234', title: '5551234' }],
      ['setting', { name: 'restore' }],
    ]);
  });

  it('writes what it reads back, its words bare where they can be', () => {
    const once = parseFlow(STEPS);
    const text = flowText(once);
    expect(text).toBe(`screenshot home
visual home
visual checkout tolerance=0.5 mask="id=clock" mask="role=image text=\\"Map\\"" mask="0,600,1080,200"
setting dark_mode on
setting text_size accessibility-large
setting locale tr-TR app=org.example
setting sms "Your code is 1234" title=5551234
setting restore
`);
    const body = (f: Flow) => f.steps.map(({ line: _line, ...rest }) => rest);
    expect(body(parseFlow(text))).toEqual(body(once));
  });

  it('reads a shake and a memory warning with no value, a stop in the background and a launch with the probe', () => {
    const text = `app dev.x

setting shake
setting memory_warning
setting memory_warning RUNNING_LOW app=dev.other
stop background
launch probe
`;
    const f = parseFlow(text);
    expect(f.steps.map((s) => [s.action, s.args])).toEqual([
      ['setting', { name: 'shake' }],
      ['setting', { name: 'memory_warning' }],
      ['setting', { name: 'memory_warning', value: 'RUNNING_LOW', app: 'dev.other' }],
      ['stop', { background: true }],
      ['launch', { probe: true }],
    ]);
    expect(flowText(f)).toBe(text);
    const yaml = (line: string) => () => toMaestro(parseFlow(`app dev.x\n${line}\n`));
    expect(yaml('stop background')).toThrow('Maestro YAML has no background for stop');
    expect(yaml('launch probe')).toThrow('Maestro YAML has no probe for launch');
  });

  it('reads a mask as a place or as selector words, and writes it back as it was', () => {
    expect(maskOf('0,600,1080,200')).toEqual({ x: 0, y: 600, w: 1080, h: 200 });
    expect(maskOf('id=clock')).toEqual({ id: 'clock' });
    expect(maskOf('role=image text="Last seen"')).toEqual({ role: 'image', text: 'Last seen' });
    expect(maskOf('-12.5,-4,100,20')).toEqual({ x: -12.5, y: -4, w: 100, h: 20 });
    for (const m of [{ x: 0, y: 600, w: 1080, h: 200 }, { id: 'a b' }, { role: 'r', text: 'T' }])
      expect(maskOf(maskText(m))).toEqual(m);
  });

  it('refuses a line it could not run, saying why', () => {
    const bad = (text: string, says: string) => expect(() => parseFlow(text)).toThrow(says);
    bad('screenshot', 'line 1: screenshot needs name');
    bad('screenshot ../home', 'screenshot: a name is letters, digits, dot, dash and underscore');
    bad('visual "home page"', 'visual: a name is letters');
    bad('visual home tolerance=101', 'visual: tolerance is a percent of the pixels, 0 to 100');
    bad('visual home tolerance=much', 'tolerance needs a number');
    bad('visual home mask=1,2,3', 'a mask is x,y,w,h or id=, role=, text=: 1,2,3');
    bad('visual home mask="index=2"', 'a mask is x,y,w,h');
    bad('visual home mask=1,2,0,4', 'a mask has a width and a height');
    bad('setting dark_mode', 'setting dark_mode needs a value, as in setting dark_mode on');
    bad('setting restore all', 'setting restore puts back every setting changed');
    bad('setting restore app=dev.app', 'setting restore puts back every setting changed');
    bad('visual home !ambiguous extra', 'visual: unexpected word extra');
  });

  it('exports a screenshot, and refuses a comparison or a setting with the reason', () => {
    const yaml = (body: string) => toMaestro(parseFlow(`app dev.x\n${body}\n`));
    expect(yaml('screenshot home')).toContain('- takeScreenshot: "home"\n');
    expect(() => yaml('visual home')).toThrow(
      'step 1 (line 2, visual): Maestro YAML has no comparison with a saved picture',
    );
    expect(() => yaml('screenshot a\nsetting dark_mode on')).toThrow(
      'step 2 (line 3, setting): a device setting has no checked form in Maestro YAML',
    );
  });
});
