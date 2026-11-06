import { FlowError, type Flow, type FlowSelector, type FlowStep } from './format.js';

type Yaml = string | number | boolean | { [k: string]: Yaml | undefined };

const MAESTRO_KEYS: Record<string, string> = {
  enter: 'Enter',
  home: 'Home',
  delete: 'Backspace',
  tab: 'Tab',
  volumeUp: 'Volume Up',
  volumeDown: 'Volume Down',
  power: 'Power',
  lock: 'Lock',
};

/** Maestro names the way the view scrolls; ours, like a swipe, the way the finger goes. */
const SCROLL = { up: 'DOWN', down: 'UP', left: 'RIGHT', right: 'LEFT' } as const;
const REGEX_CHAR = /[.*+?^${}()|[\]\\]/g;

const unsupported = (why: string): never => {
  throw new Error(why);
};

/** A text as Maestro's selector takes it, a regular expression: literal, placeholders left to fill. */
const literal = (text: string) =>
  text
    .split(/(\$\{[A-Z_][A-Z0-9_]*\})/)
    .map((part, i) => (i % 2 === 1 ? part : part.replace(REGEX_CHAR, '\\$&')))
    .join('');

/** A string Maestro cannot read as ours: a literal `${` has no escape there. */
const plain = (value: string) => {
  if (value.includes('$${')) unsupported('a literal ${ has no form in Maestro');
  return value;
};

/** Maestro has no role: role and text become text, which may match more than the two did. */
function maestroSelector(s: FlowSelector | undefined): Record<string, Yaml> {
  if (!s?.id && !s?.text) return unsupported('Maestro has no selector by role alone');
  return {
    ...(s.id && { id: literal(plain(s.id)) }),
    ...(s.text && { text: literal(plain(s.text)) }),
    ...(s.index !== undefined && { index: s.index }),
  };
}

const targetOf = (st: FlowStep): Record<string, Yaml> =>
  st.args.x !== undefined
    ? unsupported('coordinates are for one screen size: name the target')
    : maestroSelector(st.selector);

const none = (st: FlowStep, ...args: string[]) => {
  for (const a of args)
    if (st.args[a] !== undefined) unsupported(`Maestro has no ${a} for ${st.action}`);
};

function commands(st: FlowStep): Yaml[] {
  const a = st.args;
  switch (st.action) {
    case 'launch':
      // Maestro's launchApp stops the app first; our launch brings a running one forward as it is
      return [
        { launchApp: { ...(a.app ? { appId: plain(a.app as string) } : {}), stopApp: false } },
      ];
    case 'stop':
      return a.app ? [{ stopApp: plain(a.app as string) }] : ['stopApp'];
    case 'tap':
      return [{ tapOn: targetOf(st) }];
    case 'long_press':
      none(st, 'durationMs');
      return [{ longPressOn: targetOf(st) }];
    case 'double_tap':
      return [{ doubleTapOn: targetOf(st) }];
    case 'type':
      if (a.replace) unsupported('Maestro erases a count of characters, not the whole field');
      return [
        ...(st.selector || a.x !== undefined ? [{ tapOn: targetOf(st) }] : []),
        { inputText: plain(a.text as string) },
        ...(a.submit ? [{ pressKey: 'Enter' }] : []),
      ];
    case 'press_key': {
      if (a.key === 'back') return ['back'];
      const key = MAESTRO_KEYS[a.key as string];
      return key ? [{ pressKey: key }] : unsupported(`Maestro has no key ${String(a.key)}`);
    }
    case 'swipe':
      none(st, 'distance', 'x', 'y');
      return [
        {
          swipe: {
            direction: (a.direction as string).toUpperCase(),
            ...(st.selector && { from: maestroSelector(st.selector) }),
            ...(a.durationMs !== undefined && { duration: a.durationMs }),
          },
        },
      ];
    case 'scroll_to':
      none(st, 'maxSwipes');
      return [
        {
          scrollUntilVisible: {
            element: maestroSelector(st.selector),
            direction: SCROLL[(a.direction ?? 'up') as keyof typeof SCROLL],
          },
        },
      ];
    case 'wait_for':
      return [
        {
          extendedWaitUntil: {
            [a.gone ? 'notVisible' : 'visible']: maestroSelector(st.selector),
            timeout: a.timeoutMs ?? 10_000,
          },
        },
      ];
    case 'assert': {
      const yes = a.expect !== false;
      const check = a.check ?? 'exists';
      if (check === 'moves') unsupported('Maestro has no check of what moves on a screen');
      const sel = maestroSelector(st.selector);
      if (check === 'exists' || check === 'absent') {
        const shows = (check === 'exists') === yes;
        return a.timeoutMs === undefined
          ? [{ [shows ? 'assertVisible' : 'assertNotVisible']: sel }]
          : [
              {
                extendedWaitUntil: {
                  [shows ? 'visible' : 'notVisible']: sel,
                  timeout: a.timeoutMs,
                },
              },
            ];
      }
      none(st, 'timeoutMs');
      if (check === 'text') {
        if (!yes) unsupported('Maestro has no check that a text is another');
        return [{ assertVisible: { ...sel, text: literal(plain(a.equals as string)) } }];
      }
      return [{ assertVisible: { ...sel, [check as string]: yes } }];
    }
    case 'open_link':
      if (a.settings) unsupported('Maestro opens no page of Settings');
      return [{ openLink: plain(a.url as string) }];
    case 'set_location':
      return [{ setLocation: { latitude: String(a.lat), longitude: String(a.lon) } }];
    case 'hide_keyboard':
      return ['hideKeyboard'];
    case 'alert':
      return unsupported('Maestro answers a system alert by its words, in one language');
    case 'unrecorded':
      return unsupported(`not recorded: ${String(a.what)}`);
    case 'run':
      return unsupported(`${String(a.file)} was not read in`);
  }
}

const scalar = (v: string | number | boolean) => (typeof v === 'string' ? JSON.stringify(v) : v);

/** One command at this indent; a map's values below it. JSON's strings are YAML's double-quoted ones. */
function write(value: Yaml, indent: string): string[] {
  if (typeof value !== 'object') return [`${indent}${scalar(value)}`];
  return Object.entries(value).flatMap(([k, v]) => {
    if (v === undefined) return [];
    return typeof v === 'object'
      ? [`${indent}${k}:`, ...write(v, `${indent}  `)]
      : [`${indent}${k}: ${scalar(v)}`];
  });
}

/**
 * The flow as Maestro YAML, or a refusal naming every step it has no form for: an export that quietly
 * dropped a step would pass where the flow fails. Maestro's text is a whole-text match where ours also
 * takes a part of a label.
 */
export function toMaestro(flow: Flow): string {
  if (!flow.app) throw new FlowError('Maestro needs an app: add app to the flow', 0);
  const broken: string[] = [];
  const lines = [
    `appId: ${JSON.stringify(flow.app)}`,
    ...(flow.tags.length > 0 ? ['tags:', ...flow.tags.map((t) => `  - ${t}`)] : []),
    '---',
  ];
  for (const [i, st] of flow.steps.entries()) {
    try {
      if (st.selector?.role && (st.selector.id || st.selector.text))
        lines.push(`# step ${i + 1}: role=${st.selector.role} left out, Maestro has no role`);
      for (const c of commands(st)) {
        if (typeof c === 'string') lines.push(`- ${c}`);
        else {
          const [first, ...rest] = write(c, '  ');
          lines.push(`- ${first!.trimStart()}`, ...rest);
        }
      }
    } catch (e) {
      broken.push(`step ${i + 1} (line ${st.line}, ${st.action}): ${(e as Error).message}`);
    }
  }
  if (broken.length > 0) throw new FlowError(`cannot export to Maestro:\n${broken.join('\n')}`, 0);
  return `${lines.join('\n')}\n`;
}
