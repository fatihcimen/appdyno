import {
  alertButton,
  diffScreens,
  diffText,
  fold,
  renderScreen,
  screenStructure,
  type ActOptions,
  type ActResult,
  type Point,
  type Screen,
  type TextResult,
  UNCHANGED,
} from 'appdyno';
import { z } from 'zod';
import { checkApp, checkUrl, redact, type Policy } from './policy.js';
import type { ServerContext } from './context.js';
import { refused, type Session } from './session.js';
import { perfTools } from './perf-tools.js';
import {
  ActionOut,
  DeviceOut,
  DevicesOut,
  DoneOut,
  FindOut,
  ScreenOut,
  ScreenshotOut,
  WaitOut,
} from './schemas.js';
import { ACT, DESTRUCTIVE, READ, reply, ToolError, type Tool, type ToolResult } from './tool.js';

/** After an action: quiet window and cap of the on-device settle (the window: docs/protocol.md, measured). */
export const SETTLE = { quietMs: 200, maxMs: 3_000 } as const;
const WAIT_MS = 5_000;
const MAX_WAIT_MS = 15_000;
const WAIT_GAP_MS = 300;
export const SHOT_PX = 1024;
const MAX_STEPS = 12;
const STALE = 'stale ref, read the screen again';
const MAYBE_MOVING = 'the screen may still be changing';
const NO_APP = 'give app (or select one with use_device)';

const Device = z
  .string()
  .max(64)
  .optional()
  .describe('device (list_devices); default: the selected device');
const Read = z
  .enum(['diff', 'full', 'none'])
  .default('diff')
  .describe('the screen after the action: diff (what changed, default), full (whole screen), none');
const Ref = z
  .string()
  .regex(/^@[a-z0-9]{1,10}(-\d{1,3})?$/, 'a ref as the screen shows it (@k3f9)');
const Coord = z.number().min(0).max(10_000);
const Target = { ref: Ref.optional(), x: Coord.optional(), y: Coord.optional() };
const Direction = z.enum(['up', 'down', 'left', 'right']);
const Keys = z.enum(['back', 'enter', 'home', 'delete', 'tab']);

const TapStep = z.object({ action: z.literal('tap'), ...Target }).strict();
const LongPressStep = z
  .object({
    action: z.literal('long_press'),
    ...Target,
    durationMs: z.number().int().min(100).max(5_000).optional(),
  })
  .strict();
const SwipeStep = z
  .object({
    action: z.literal('swipe'),
    direction: Direction,
    x: Coord.optional(),
    y: Coord.optional(),
    distance: z.number().min(10).max(5_000).optional(),
    durationMs: z.number().int().min(50).max(5_000).optional(),
  })
  .strict();
const TypeStep = z
  .object({
    action: z.literal('type_text'),
    text: z.string().max(500),
    ref: Ref.optional(),
    replace: z.boolean().optional(),
    submit: z.boolean().optional(),
  })
  .strict();
const KeyStep = z.object({ action: z.literal('press_key'), key: Keys }).strict();
const Step = z.discriminatedUnion('action', [TapStep, LongPressStep, SwipeStep, TypeStep, KeyStep]);
type Step = z.infer<typeof Step>;
type ReadMode = z.infer<typeof Read>;

/** A tool; its structured answer follows `output` (an action's summary unless said otherwise). */
const tool = <S extends z.ZodObject>(
  title: string,
  description: string,
  input: S,
  annotations: Tool['annotations'],
  handler: (args: z.infer<S>) => Promise<ToolResult>,
  output: z.ZodObject = ActionOut,
): Tool => ({
  title,
  description,
  input,
  output,
  annotations,
  handler: handler as Tool['handler'],
});

/**
 * A swipe's start and end on a screen of `size`: from x,y (the centre) by `distance` (40 % of the
 * screen), both points inside the screen (an edge point would start a system gesture).
 */
export function swipeLine(
  size: { w: number; h: number },
  s: { direction: z.infer<typeof Direction>; x?: number; y?: number; distance?: number },
): { from: Point; to: Point } {
  const horizontal = s.direction === 'left' || s.direction === 'right';
  const from = { x: s.x ?? size.w / 2, y: s.y ?? size.h / 2 };
  const dist = s.distance ?? (horizontal ? size.w : size.h) * 0.4;
  // the finger's way: `up` moves the content up (the list scrolls on)
  const sign = s.direction === 'up' || s.direction === 'left' ? -1 : 1;
  const to = horizontal
    ? { x: from.x + sign * dist, y: from.y }
    : { x: from.x, y: from.y + sign * dist };
  const clamp = (p: Point) => ({
    x: Math.round(Math.min(Math.max(p.x, 1), size.w - 1)),
    y: Math.round(Math.min(Math.max(p.y, 1), size.h - 1)),
  });
  return { from: clamp(from), to: clamp(to) };
}

/** Two fingers from the point outwards (scale > 1, zoom in) or inwards (scale < 1). */
export function pinchPaths(
  c: Point,
  scale: number,
  durationMs: number,
  size: { w: number; h: number },
) {
  const r0 = Math.min(size.w, size.h) * (scale >= 1 ? 0.1 : 0.3);
  const r1 = Math.min(Math.max(r0 * scale, 10), Math.min(size.w, size.h) * 0.45);
  const finger = (sign: number) => [
    { x: c.x + sign * r0, y: c.y, t: 0 },
    { x: c.x + sign * r1, y: c.y, t: durationMs },
  ];
  return [finger(-1), finger(1)];
}

export function createTools(ctx: ServerContext): Record<string, Tool> {
  const policy: Policy = ctx.policy;
  const clean = (s: string) => redact(policy, s);

  const header = (s: Session, screen: Screen) =>
    `${screen.foreground ? `foreground: ${screen.foreground}\n` : ''}${renderScreen(screen.list, clean)}`;

  /** The app check: a permission prompt points to dismiss_alert; another app in front is said. */
  const foreground = (s: Session, screen: Screen) => {
    if (alertButton(screen.elements, s.device.platform, 'allow'))
      return '\na system permission prompt is open: answer it with dismiss_alert';
    if (!s.appId || !screen.foreground || screen.foreground === s.appId) return '';
    return `\nWARNING: the app is not in the foreground (${screen.foreground}): if it crashed, bring it back with launch_app`;
  };

  /** The OS as people name it: Android 14, iOS 18.2. */
  const osName = (s: Session) =>
    `${s.device.platform === 'ios' ? 'iOS' : 'Android'} ${s.device.hello!.osVersion}`;

  const info = (s: Session) => {
    const h = s.device.hello!;
    return {
      serial: s.device.serial,
      model: h.model,
      os: osName(s),
      ...(h.sdk !== undefined && { sdk: h.sdk }),
      screen: h.screen,
      agentVersion: h.agentVersion,
    };
  };

  const show = (s: Session, screen: Screen) => {
    s.remember(screen);
    s.shown = screen.list;
  };

  /** The answer of an action: what was done, the app check and the screen after it. */
  const answer = (
    s: Session,
    done: string,
    read: ReadMode,
    before: Session['shown'],
    r?: ActResult,
  ) => {
    if (read === 'none' || !r?.tree) return reply(done, summary(done));
    const screen = s.screenOf(r.tree);
    show(s, screen);
    const moving = r.settle && !r.settle.settled ? ` (${MAYBE_MOVING})` : '';
    const d = read === 'diff' && before ? diffScreens(before, screen.list) : undefined;
    const diff = d && diffText(d, screen.list.length, clean);
    const fg = foreground(s, screen);
    return reply(
      `${done}${fg}${moving}\n${diff ?? header(s, screen)}`,
      summary(done, screen, { diff, d, fg, settled: r.settle?.settled }),
    );
  };

  /** The structured answer of an action (ActionOut). */
  const summary = (
    done: string,
    screen?: Screen,
    o: { diff?: string; d?: ReturnType<typeof diffScreens>; fg?: string; settled?: boolean } = {},
  ): ActionOut => ({
    done: clean(done),
    screen: !screen
      ? 'none'
      : o.diff === undefined
        ? 'full'
        : o.diff.startsWith(UNCHANGED)
          ? 'unchanged'
          : 'diff',
    ...(o.d && {
      changes: {
        added: o.d.added.length,
        removed: o.d.removed.length,
        changed: o.d.changed.length,
      },
    }),
    ...(screen && { elements: screen.list.length }),
    ...(screen?.foreground && { foreground: screen.foreground }),
    ...(o.settled !== undefined && { settled: o.settled }),
    warnings: [...(o.fg ? [o.fg.trim()] : []), ...(o.settled === false ? [MAYBE_MOVING] : [])],
  });

  /** Runs a device action with the settle and read `read` asks for. */
  const act = async (
    s: Session,
    read: ReadMode,
    run: (o: ActOptions) => Promise<ActResult | TextResult>,
    done: string | ((r: ActResult | TextResult) => string),
  ) => {
    const before = s.shown;
    const opts: ActOptions =
      read === 'none'
        ? { settle: false, read: 'none' }
        : { settle: SETTLE, read: 'tree', ...(s.fresh && { before: s.fresh.hash }) };
    const r = await run(opts).catch(refused);
    s.acted();
    return answer(s, typeof done === 'string' ? done : done(r), read, before, r);
  };

  /** Reads until two reads in a row have the same layout, at most `maxMs` (after a link or a launch). */
  const settleRead = async (s: Session, maxMs = SETTLE.maxMs) => {
    const end = Date.now() + maxMs;
    let screen = await s.read();
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 200));
      const next = await s.read();
      if (next.hash === screen.hash) return { screen: next, settled: true };
      screen = next;
    }
    return { screen, settled: false };
  };

  const afterChange = async (s: Session, done: string, read: ReadMode) => {
    const before = s.shown;
    s.acted();
    if (read === 'none') return reply(done, summary(done));
    const { screen, settled } = await settleRead(s);
    show(s, screen);
    const d = read === 'diff' && before ? diffScreens(before, screen.list) : undefined;
    const diff = d && diffText(d, screen.list.length, clean);
    const fg = foreground(s, screen);
    return reply(
      `${done}${fg}${settled ? '' : ` (${MAYBE_MOVING})`}\n${diff ?? header(s, screen)}`,
      summary(done, screen, { diff, d, fg, settled }),
    );
  };

  /** The point of a ref (on the device's current screen) or of x,y. */
  const target = async (s: Session, a: { ref?: string; x?: number; y?: number }) => {
    if (a.ref) {
      const e = (await s.current()).list.find((x) => x.ref === a.ref);
      if (!e) throw new ToolError(`${STALE}: ${a.ref} is not on this screen`);
      return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.x === undefined || a.y === undefined) throw new ToolError('give a ref, or x and y');
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  };

  const windowSize = async (s: Session) => {
    const w =
      (await s.current()).window ??
      (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
    if (!w) throw new ToolError('the screen size is unknown: give x, y and distance');
    return w;
  };

  /** One step's device call (a ref resolved on the current screen right before it). */
  const step = async (
    s: Session,
    st: Step,
    opts: ActOptions,
  ): Promise<{ r: ActResult | TextResult; done: string }> => {
    switch (st.action) {
      case 'tap': {
        const t = await target(s, st);
        return { r: await s.device.tap(t.point, opts), done: `tapped ${t.name}` };
      }
      case 'long_press': {
        const t = await target(s, st);
        return {
          r: await s.device.longPress(t.point, st.durationMs ?? 800, opts),
          done: `long-pressed ${t.name}`,
        };
      }
      case 'swipe': {
        const { from, to } = swipeLine(await windowSize(s), st);
        return {
          r: await s.device.swipe(from, to, st.durationMs ?? 300, opts),
          done: `swiped (${st.direction})`,
        };
      }
      case 'type_text': {
        const at = st.ref ? (await target(s, { ref: st.ref })).point : undefined;
        const r = await s.device.typeText(st.text, {
          ...(at && { at }),
          replace: st.replace ?? false,
          submit: st.submit ?? false,
          ...opts,
        });
        // never the text itself (it may be a phone number or a code)
        return {
          r,
          done: `typed (${Array.from(st.text).length} characters${st.submit ? ', submitted' : ''}${r.verified ? '' : ', not verified'})`,
        };
      }
      case 'press_key': {
        if (st.key === 'home' && !policy.allowHome)
          throw new ToolError('home is off on this server: the app may not be left');
        return { r: await s.device.key(st.key, opts), done: `pressed ${st.key}` };
      }
    }
  };

  const one = async (s: Session, st: Step, read: ReadMode) => {
    let done = '';
    return act(
      s,
      read,
      async (o) => {
        const x = await step(s, st, o);
        done = x.done;
        return x.r;
      },
      () => done,
    );
  };

  const tools: Record<string, Tool> = {
    list_devices: tool(
      'Devices',
      'Connected devices (serial, state, model) and which of them this server may drive.',
      z.object({}).strict(),
      READ,
      async () => {
        const all = await ctx.adb.devices().catch(refused);
        const sims = await ctx.simulators();
        const phones = await ctx.phones();
        const devices = [
          ...all.map((d) => ({
            serial: d.serial,
            state: d.state,
            ...(d.props.model && { model: d.props.model }),
          })),
          // booted iOS simulators, named by their id
          ...sims.map((d) => ({
            serial: d.udid,
            state: 'booted',
            model: `iOS simulator ${d.name}`,
          })),
          ...phones.map((udid) => ({ serial: udid, state: 'usb', model: 'iPhone' })),
        ].map((d) => ({
          ...d,
          allowed: ctx.allowed(d.serial),
          selected: d.serial === ctx.currentSerial,
        }));
        if (devices.length === 0)
          return reply('no device connected (adb lists none, no simulator is booted)', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''}${d.allowed ? '' : ' (not allowed on this server)'}${d.selected ? ' ← selected' : ''}`,
            )
            .join('\n'),
          { devices },
        );
      },
      DevicesOut,
    ),
    use_device: tool(
      'Use device',
      'Drive this device (starts its agent or connects to it); app: the package or bundle id of the app under test.',
      z.object({ device: z.string().max(64), app: z.string().max(200).optional() }).strict(),
      { ...READ, idempotentHint: true, readOnlyHint: false },
      async ({ device, app }) => {
        const s = await ctx.use(device, app);
        const h = s.device.hello!;
        return reply(
          `selected ${device}: ${h.model}, ${osName(s)}, screen ${h.screen.w}x${h.screen.h}` +
            `${s.device.lastStartWasCold ? ' (agent started)' : ''}${s.appId ? `; app ${s.appId}` : ''}`,
          {
            ...info(s),
            agentStarted: s.device.lastStartWasCold,
            ...(s.appId && { app: s.appId }),
          },
        );
      },
      DeviceOut,
    ),
    device_info: tool(
      'Device info',
      "The selected device's model, OS version, screen, agent capabilities and the app in the foreground.",
      z.object({ device: Device }).strict(),
      READ,
      async ({ device }) => {
        const s = await ctx.session(device);
        const h = s.device.hello!;
        const fg = await s.device.foreground().catch(refused);
        return reply(
          [
            `${s.device.serial}: ${h.model}, ${osName(s)}${h.sdk !== undefined ? ` (SDK ${h.sdk})` : ''}`,
            `screen ${h.screen.w}x${h.screen.h}, density ${h.screen.density}, rotation ${h.screen.rotation}`,
            `agent ${h.agentVersion}, protocol ${h.protocol.major}.${h.protocol.minor}, capabilities: ${h.capabilities.join(', ')}`,
            `foreground: ${fg ?? 'unknown'}`,
          ].join('\n'),
          { ...info(s), capabilities: h.capabilities, ...(fg && { foreground: fg }) },
        );
      },
      DeviceOut,
    ),
    screen: tool(
      'Read screen',
      'The elements on the screen (ref role "label" x,y flags). Use refs with tap/type_text; a ref keeps naming the same element when the screen changes.',
      z.object({ device: Device }).strict(),
      READ,
      async ({ device }) => {
        const s = await ctx.session(device);
        const screen = await s.read();
        s.shown = screen.list;
        const fg = foreground(s, screen);
        return reply(`${header(s, screen)}${fg}`, {
          elements: screen.list.length,
          ...(screen.foreground && { foreground: screen.foreground }),
          warnings: fg ? [fg.trim()] : [],
        });
      },
      ScreenOut,
    ),
    find: tool(
      'Find',
      'The elements whose text contains `text` or whose id is `id`, without sending the whole screen.',
      z
        .object({
          device: Device,
          text: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
        })
        .strict(),
      READ,
      async ({ device, text: want, id }) => {
        if (!want && !id) throw new ToolError('give text or id');
        const s = await ctx.session(device);
        const screen = await s.read();
        const w = want && fold(want);
        const hits = screen.list.filter(
          (e) => (!w || fold(e.label).includes(w)) && (!id || e.id === id),
        );
        const matches = hits.map((e) => ({
          ref: e.ref,
          role: e.role,
          label: clean(e.label),
          ...(e.id && { id: e.id }),
          x: e.x,
          y: e.y,
        }));
        if (hits.length === 0)
          return reply(`not found (${screen.list.length} elements)`, { matches });
        return reply(renderScreen(hits, clean), { matches });
      },
      FindOut,
    ),
    wait_for: tool(
      'Wait for',
      `Wait until an element shows (gone: until it is gone): text, id or ref; timeoutMs default ${WAIT_MS}, at most ${MAX_WAIT_MS}. Use this instead of fixed sleeps.`,
      z
        .object({
          device: Device,
          text: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
          ref: Ref.optional(),
          gone: z.boolean().default(false),
          timeoutMs: z.number().int().min(300).max(MAX_WAIT_MS).default(WAIT_MS),
          read: Read,
        })
        .strict(),
      READ,
      async ({ device, text: want, id, ref, gone, timeoutMs, read }) => {
        if (!want && !id && !ref) throw new ToolError('give text, id or ref');
        const s = await ctx.session(device);
        const w = want && fold(want);
        const match = (e: Screen['list'][number]) =>
          (!w || fold(e.label).includes(w)) && (!id || e.id === id) && (!ref || e.ref === ref);
        const before = s.shown;
        const end = Date.now() + timeoutMs;
        let last: Screen | undefined;
        let met = false;
        for (;;) {
          const now = await s.read().catch(() => undefined);
          // a failed read is no answer: never "gone"
          if (now) {
            last = now;
            met = now.list.some(match) !== gone;
          }
          if (met || Date.now() >= end) break;
          await new Promise((r) => setTimeout(r, WAIT_GAP_MS));
        }
        if (!last) throw new ToolError('the screen could not be read: nothing to look in');
        show(s, last);
        const found = last.list.find(match);
        const head = met
          ? gone
            ? 'gone'
            : `found: ${found!.ref} ${JSON.stringify(clean(found!.label))}`
          : `${gone ? 'still there' : 'not shown'} after ${timeoutMs} ms`;
        const out = {
          met,
          gone,
          ...(found && !gone && { found: { ref: found.ref, label: clean(found.label) } }),
        };
        if (read === 'none') return reply(head, { ...out, screen: 'none' });
        const diff =
          read === 'diff' && before
            ? diffText(diffScreens(before, last.list), last.list.length, clean)
            : undefined;
        return reply(`${head}\n${diff ?? header(s, last)}`, {
          ...out,
          screen: diff === undefined ? 'full' : diff.startsWith(UNCHANGED) ? 'unchanged' : 'diff',
        });
      },
      WaitOut,
    ),
    screenshot: tool(
      'Screenshot',
      `An image of the screen (at most ${SHOT_PX} px) and the scale from image pixels to tap units. Only for a visual judgement; read the screen with screen first. A second image of an unchanged screen is refused.`,
      z.object({ device: Device }).strict(),
      READ,
      async ({ device }) => {
        const s = await ctx.session(device);
        const layout = s.fresh ? screenStructure(s.fresh.list) : undefined;
        if (s.shot && s.shot.at === s.version && layout !== undefined && s.shot.hash === layout)
          throw new ToolError(
            'the screen has not changed since the last image: that image still holds',
          );
        const { meta, data } = await s.device
          .screenshot({ format: 'jpeg', quality: 80, maxPx: SHOT_PX })
          .catch(refused);
        const w = s.device.hello?.screen.w;
        s.shot = { at: s.version, hash: layout ?? '' };
        const scale = w ? Math.round((w / meta.w) * 1000) / 1000 : undefined;
        return reply(
          `image ${meta.w}x${meta.h} px${scale ? `; tap unit = pixel × ${scale.toFixed(3)}` : ''}`,
          { width: meta.w, height: meta.h, ...(scale && { scale }) },
          [{ type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' }],
        );
      },
      ScreenshotOut,
    ),
    tap: tool(
      'Tap',
      'Tap an element (by ref, or at x,y) and return the settled screen after it.',
      z.object({ device: Device, ...Target, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'tap', ...a }, read),
    ),
    long_press: tool(
      'Long press',
      'Long-press an element (ref or x,y; durationMs default 800).',
      z
        .object({
          device: Device,
          ...Target,
          durationMs: LongPressStep.shape.durationMs,
          read: Read,
        })
        .strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'long_press', ...a }, read),
    ),
    swipe: tool(
      'Swipe',
      'Swipe. direction: up (content moves up, a list scrolls on), down, left, right; optional start x,y and distance.',
      z.object({ device: Device, ...SwipeStep.omit({ action: true }).shape, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'swipe', ...a }, read),
    ),
    pinch: tool(
      'Pinch',
      'Pinch with two fingers: scale > 1 zooms in, < 1 zooms out; centre x,y (default: the middle of the screen).',
      z
        .object({
          device: Device,
          x: Coord.optional(),
          y: Coord.optional(),
          scale: z.number().min(0.2).max(5),
          durationMs: z.number().int().min(100).max(3_000).default(400),
          read: Read,
        })
        .strict(),
      ACT,
      async ({ device, x, y, scale, durationMs, read }) => {
        const s = await ctx.session(device);
        const size = await windowSize(s);
        const c = { x: x ?? size.w / 2, y: y ?? size.h / 2 };
        return act(
          s,
          read,
          (o) =>
            s.device.act({ kind: 'gesture', pointers: pinchPaths(c, scale, durationMs, size) }, o),
          `pinched (×${scale})`,
        );
      },
    ),
    type_text: tool(
      'Type text',
      "Type into the focused field. With a ref the field is tapped first and its focus waited for; replace: replaces the field's text; submit: enter afterwards. Any Unicode text.",
      z.object({ device: Device, ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'type_text', ...a }, read),
    ),
    press_key: tool(
      'Press key',
      'Press a key: back, enter, home (off when the server turned it off), delete, tab.',
      z.object({ device: Device, key: Keys, read: Read }).strict(),
      ACT,
      async ({ device, key, read }) =>
        one(await ctx.session(device), { action: 'press_key', key }, read),
    ),
    steps: tool(
      'Steps',
      `Run a known sequence (a login, a form) in one call, at most ${MAX_STEPS} steps; each step is { action: tap | long_press | swipe | type_text | press_key, ... }. The screen is read again before a ref step; stops at the first failure. One read at the end.`,
      z.object({ device: Device, steps: z.array(Step).min(1).max(MAX_STEPS), read: Read }).strict(),
      ACT,
      async ({ device, steps, read }) => {
        const s = await ctx.session(device);
        const refs = steps.flatMap((st) => ('ref' in st && st.ref ? [st.ref] : []));
        if (refs.length > 0) {
          const screen = await s.current();
          const unknown = refs.filter((r) => !screen.list.some((e) => e.ref === r));
          if (unknown.length > 0)
            throw new ToolError(`${STALE}: ${[...new Set(unknown)].join(', ')} not on this screen`);
        }
        const done: string[] = [];
        for (const [i, st] of steps.entries()) {
          const last = i === steps.length - 1;
          try {
            if (!last) {
              const x = await step(s, st, { settle: false, read: 'none' }).catch(refused);
              s.acted();
              done.push(`${i + 1}. ${x.done}`);
              continue;
            }
            let lastDone = '';
            return await act(
              s,
              read,
              async (o) => {
                const x = await step(s, st, o);
                lastDone = x.done;
                return x.r;
              },
              () => [...done, `${i + 1}. ${lastDone}`].join('\n'),
            );
          } catch (e) {
            if (!(e instanceof ToolError)) throw e;
            if (done.length === 0) throw e;
            const t = `${done.join('\n')}\n${i + 1}. step failed, the rest were not run: ${e.message}`;
            return reply(t, { ...summary(t), warnings: [e.message] });
          }
        }
        return reply(done.join('\n'), summary(done.join('\n')));
      },
    ),
    dismiss_alert: tool(
      'Answer permission prompt',
      "Answer an open system permission prompt (location, notifications, camera…): allow (default) or deny. Never touches the app's own dialogs.",
      z
        .object({ device: Device, action: z.enum(['allow', 'deny']).default('allow'), read: Read })
        .strict(),
      ACT,
      async ({ device, action, read }) => {
        const s = await ctx.session(device);
        const screen = await s.read();
        const button = alertButton(screen.elements, s.device.platform, action);
        if (!button)
          return reply(
            "no system permission prompt is open (the app's own dialogs are not touched)",
            summary('no system permission prompt is open'),
          );
        return act(
          s,
          read,
          (o) => s.device.tap(button, o),
          `answered the system prompt: ${JSON.stringify(button.label)}`,
        );
      },
    ),
    open_link: tool(
      'Open link',
      'Open a link (https:// or an app scheme) and return the screen it opened; with an app selected the link opens in it.',
      z.object({ device: Device, url: z.string().min(3).max(2_000), read: Read }).strict(),
      ACT,
      async ({ device, url, read }) => {
        const s = await ctx.session(device);
        const href = checkUrl(policy, url);
        await s.device.openUrl(href, s.appId).catch(refused);
        return afterChange(s, `opened ${href}`, read);
      },
    ),
    launch_app: tool(
      'Launch app',
      'Launch the app (brings it to the front when it runs) and return its screen; default: the selected app.',
      z.object({ device: Device, app: z.string().max(200).optional(), read: Read }).strict(),
      DESTRUCTIVE,
      async ({ device, app, read }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP);
        await s.device.launch(pkg).catch(refused);
        return afterChange(s, `launched ${pkg}`, read);
      },
    ),
    terminate_app: tool(
      'Terminate app',
      'Stop the app (force-stop); default: the selected app.',
      z.object({ device: Device, app: z.string().max(200).optional() }).strict(),
      DESTRUCTIVE,
      async ({ device, app }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP);
        await s.device.terminate(pkg).catch(refused);
        s.acted();
        return reply(`stopped ${pkg}`, { done: `stopped ${pkg}` });
      },
      DoneOut,
    ),
    set_orientation: tool(
      'Orientation',
      'Screen orientation: portrait or landscape (the rotation stays fixed; go back to portrait afterwards).',
      z
        .object({ device: Device, orientation: z.enum(['portrait', 'landscape']), read: Read })
        .strict(),
      ACT,
      async ({ device, orientation, read }) => {
        const s = await ctx.session(device);
        await s.device.setOrientation(orientation === 'portrait' ? 0 : 1).catch(refused);
        return afterChange(s, `orientation: ${orientation}`, read);
      },
    ),
    set_clipboard: tool(
      'Set clipboard',
      'Put a text on the clipboard (for paste tests).',
      z.object({ device: Device, text: z.string().min(1).max(2_000) }).strict(),
      ACT,
      async ({ device, text: value }) => {
        if (policy.secrets.some((x) => x && value.includes(x)))
          throw new ToolError('a secret is never put on the clipboard');
        const s = await ctx.session(device);
        await s.device.setClipboard(value).catch(refused);
        const done = `on the clipboard (${Array.from(value).length} characters)`;
        return reply(done, { done });
      },
      DoneOut,
    ),
    set_location: tool(
      'Set location',
      "Fix the device's GPS position (latitude, longitude).",
      z
        .object({
          device: Device,
          lat: z.number().min(-90).max(90),
          lon: z.number().min(-180).max(180),
        })
        .strict(),
      ACT,
      async ({ device, lat, lon }) => {
        const s = await ctx.session(device);
        await s.device.setLocation(lat, lon).catch(refused);
        const done = `location: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
      DoneOut,
    ),
    ...perfTools(ctx, ctx.measurementsDir),
  };
  return tools;
}
