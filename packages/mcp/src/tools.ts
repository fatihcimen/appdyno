import {
  alertButton,
  diffScreens,
  diffText,
  renderScreen,
  screenStructure,
  type ActOptions,
  type ActResult,
  type Point,
  type Screen,
  type TextResult,
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
const STALE = 'ref eskidi, ekranı yeniden oku';

const Device = z
  .string()
  .max(64)
  .optional()
  .describe('cihaz (list_devices); verilmezse seçili cihaz');
const Read = z
  .enum(['diff', 'full', 'none'])
  .default('diff')
  .describe('eylemden sonra ekran: diff (değişenler, varsayılan), full (tüm ekran), none');
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
    `${screen.foreground ? `ön planda: ${screen.foreground}\n` : ''}${renderScreen(screen.list, clean)}`;

  /** The app check: a permission prompt points to dismiss_alert; another app in front is said. */
  const foreground = (s: Session, screen: Screen) => {
    if (alertButton(screen.elements, 'android', 'allow'))
      return '\nsistem izin penceresi açık: dismiss_alert ile yanıtla';
    if (!s.appId || !screen.foreground || screen.foreground === s.appId) return '';
    return `\nUYARI: uygulama ön planda değil (${screen.foreground}): çöktüyse launch_app ile geri appdyno`;
  };

  const info = (s: Session) => {
    const h = s.device.hello!;
    return {
      serial: s.device.serial,
      model: h.model,
      os: `Android ${h.osVersion}`,
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
    const moving = r.settle && !r.settle.settled ? ' (ekran hâlâ değişiyor olabilir)' : '';
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
        : o.diff.startsWith('ekran değişmedi')
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
    warnings: [
      ...(o.fg ? [o.fg.trim()] : []),
      ...(o.settled === false ? ['ekran hâlâ değişiyor olabilir'] : []),
    ],
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
      `${done}${fg}${settled ? '' : ' (ekran hâlâ değişiyor olabilir)'}\n${diff ?? header(s, screen)}`,
      summary(done, screen, { diff, d, fg, settled }),
    );
  };

  /** The point of a ref (on the device's current screen) or of x,y. */
  const target = async (s: Session, a: { ref?: string; x?: number; y?: number }) => {
    if (a.ref) {
      const e = (await s.current()).list.find((x) => x.ref === a.ref);
      if (!e) throw new ToolError(`${STALE}: ${a.ref} bu ekranda yok`);
      return { point: { x: e.x, y: e.y }, name: `${a.ref} ${JSON.stringify(clean(e.label))}` };
    }
    if (a.x === undefined || a.y === undefined) throw new ToolError('ref ya da x ve y gerekli');
    return { point: { x: a.x, y: a.y }, name: `${a.x},${a.y}` };
  };

  const windowSize = async (s: Session) => {
    const w =
      (await s.current()).window ??
      (s.device.hello && { w: s.device.hello.screen.w, h: s.device.hello.screen.h });
    if (!w) throw new ToolError('ekran boyutu bilinmiyor: x, y ve distance ver');
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
        return { r: await s.device.tap(t.point, opts), done: `dokunuldu ${t.name}` };
      }
      case 'long_press': {
        const t = await target(s, st);
        return {
          r: await s.device.longPress(t.point, st.durationMs ?? 800, opts),
          done: `uzun basıldı ${t.name}`,
        };
      }
      case 'swipe': {
        const { from, to } = swipeLine(await windowSize(s), st);
        return {
          r: await s.device.swipe(from, to, st.durationMs ?? 300, opts),
          done: `kaydırıldı (${st.direction})`,
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
          done: `yazıldı (${Array.from(st.text).length} karakter${st.submit ? ', gönderildi' : ''}${r.verified ? '' : ', doğrulanamadı'})`,
        };
      }
      case 'press_key': {
        if (st.key === 'home' && !policy.allowHome)
          throw new ToolError('home bu sunucuda kapalı: uygulamadan çıkılmaz');
        return { r: await s.device.key(st.key, opts), done: `${st.key} tuşuna basıldı` };
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
      'Cihazlar',
      'appdyno: bağlı cihazlar (seri, durum, model) ve bu sunucunun hangilerini sürebildiği.',
      z.object({}).strict(),
      READ,
      async () => {
        const all = await ctx.adb.devices().catch(refused);
        const sims = await ctx.simulators();
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
        ].map((d) => ({
          ...d,
          allowed: ctx.allowed(d.serial),
          selected: d.serial === ctx.currentSerial,
        }));
        if (devices.length === 0)
          return reply('bağlı cihaz yok (adb devices boş, açık simülatör yok)', { devices });
        return reply(
          devices
            .map(
              (d) =>
                `${d.serial} ${d.state} ${d.model ?? ''}${d.allowed ? '' : ' (bu sunucuya verilmemiş)'}${d.selected ? ' ← seçili' : ''}`,
            )
            .join('\n'),
          { devices },
        );
      },
      DevicesOut,
    ),
    use_device: tool(
      'Cihaz seç',
      'appdyno: bu cihazı sür (ajanını başlatır ya da bağlanır); app: test edilen uygulamanın paketi.',
      z.object({ device: z.string().max(64), app: z.string().max(200).optional() }).strict(),
      { ...READ, idempotentHint: true, readOnlyHint: false },
      async ({ device, app }) => {
        const s = await ctx.use(device, app);
        const h = s.device.hello!;
        return reply(
          `seçildi ${device}: ${h.model}, Android ${h.osVersion}, ekran ${h.screen.w}x${h.screen.h}` +
            `${s.device.lastStartWasCold ? ' (ajan başlatıldı)' : ''}${s.appId ? `; uygulama ${s.appId}` : ''}`,
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
      'Cihaz bilgisi',
      'appdyno: seçili cihazın modeli, sürümü, ekranı, ajan yetenekleri ve ön plandaki uygulama.',
      z.object({ device: Device }).strict(),
      READ,
      async ({ device }) => {
        const s = await ctx.session(device);
        const h = s.device.hello!;
        const fg = await s.device.foreground().catch(refused);
        return reply(
          [
            `${s.device.serial}: ${h.model}, Android ${h.osVersion} (SDK ${h.sdk ?? '?'})`,
            `ekran ${h.screen.w}x${h.screen.h} px, ${h.screen.density} dpi, dönüş ${h.screen.rotation}`,
            `ajan ${h.agentVersion}, protokol ${h.protocol.major}.${h.protocol.minor}, yetenekler: ${h.capabilities.join(', ')}`,
            `ön planda: ${fg ?? 'bilinmiyor'}`,
          ].join('\n'),
          { ...info(s), capabilities: h.capabilities, ...(fg && { foreground: fg }) },
        );
      },
      DeviceOut,
    ),
    screen: tool(
      'Ekranı oku',
      'appdyno: ekrandaki öğeler (ref role "label" x,y flags). Ref ile tap/type_text kullan; ref ekran değişse de aynı öğeyi gösterir.',
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
      'Öğe bul',
      'appdyno: ekranda metni (parçası) ya da id’si tutan öğeler, tüm ekranı göndermeden.',
      z
        .object({
          device: Device,
          text: z.string().min(1).max(200).optional(),
          id: z.string().min(1).max(200).optional(),
        })
        .strict(),
      READ,
      async ({ device, text: want, id }) => {
        if (!want && !id) throw new ToolError('text ya da id ver');
        const s = await ctx.session(device);
        const screen = await s.read();
        const w = want?.toLocaleLowerCase('tr');
        const hits = screen.list.filter(
          (e) => (!w || e.label.toLocaleLowerCase('tr').includes(w)) && (!id || e.id === id),
        );
        const matches = hits.map((e) => ({
          ref: e.ref,
          role: e.role,
          label: clean(e.label),
          ...(e.id && { id: e.id }),
          x: e.x,
          y: e.y,
        }));
        if (hits.length === 0) return reply(`bulunamadı (${screen.list.length} öğe)`, { matches });
        return reply(renderScreen(hits, clean), { matches });
      },
      FindOut,
    ),
    wait_for: tool(
      'Bekle',
      `appdyno: bir öğe görünene (gone: kaybolana) kadar bekle: text, id ya da ref; timeoutMs varsayılan ${WAIT_MS}, en fazla ${MAX_WAIT_MS}. Sabit bekleme yerine bunu kullan.`,
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
        if (!want && !id && !ref) throw new ToolError('text, id ya da ref ver');
        const s = await ctx.session(device);
        const w = want?.toLocaleLowerCase('tr');
        const match = (e: Screen['list'][number]) =>
          (!w || e.label.toLocaleLowerCase('tr').includes(w)) &&
          (!id || e.id === id) &&
          (!ref || e.ref === ref);
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
        if (!last) throw new ToolError('ekran okunamadı: beklenen öğe aranamadı');
        show(s, last);
        const found = last.list.find(match);
        const head = met
          ? gone
            ? 'kayboldu'
            : `bulundu: ${found!.ref} ${JSON.stringify(clean(found!.label))}`
          : `${timeoutMs} ms içinde ${gone ? 'kaybolmadı' : 'görünmedi'}`;
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
          screen:
            diff === undefined ? 'full' : diff.startsWith('ekran değişmedi') ? 'unchanged' : 'diff',
        });
      },
      WaitOut,
    ),
    screenshot: tool(
      'Ekran görüntüsü',
      `appdyno: ekranın görüntüsü (en fazla ${SHOT_PX} px) ve görüntü pikselinden dokunma birimine ölçek. Yalnız görsel bir yargı için; ekranı önce screen ile oku. Aynı ekranın ikinci görüntüsü reddedilir.`,
      z.object({ device: Device }).strict(),
      READ,
      async ({ device }) => {
        const s = await ctx.session(device);
        const layout = s.fresh ? screenStructure(s.fresh.list) : undefined;
        if (s.shot && s.shot.at === s.version && layout !== undefined && s.shot.hash === layout)
          throw new ToolError('ekran son görüntüden beri değişmedi: o görüntü geçerli');
        const { meta, data } = await s.device
          .screenshot({ format: 'jpeg', quality: 80, maxPx: SHOT_PX })
          .catch(refused);
        const w = s.device.hello?.screen.w;
        s.shot = { at: s.version, hash: layout ?? '' };
        const scale = w ? Math.round((w / meta.w) * 1000) / 1000 : undefined;
        return reply(
          `görüntü ${meta.w}x${meta.h} px${scale ? `; dokunma birimi = piksel × ${scale.toFixed(3)}` : ''}`,
          { width: meta.w, height: meta.h, ...(scale && { scale }) },
          [{ type: 'image', data: data.toString('base64'), mimeType: 'image/jpeg' }],
        );
      },
      ScreenshotOut,
    ),
    tap: tool(
      'Dokun',
      'appdyno: ekrandaki öğeye dokun (ref ile, ya da x,y ile) ve ekranın son halini döndür.',
      z.object({ device: Device, ...Target, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'tap', ...a }, read),
    ),
    long_press: tool(
      'Uzun bas',
      'appdyno: öğeye uzun bas (ref ya da x,y; durationMs varsayılan 800).',
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
      'Kaydır',
      'appdyno: kaydır. direction: up (içerik yukarı, liste ilerler), down, left, right; isteğe bağlı başlangıç x,y ve distance.',
      z.object({ device: Device, ...SwipeStep.omit({ action: true }).shape, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'swipe', ...a }, read),
    ),
    pinch: tool(
      'Yakınlaştır/uzaklaştır',
      'appdyno: iki parmakla sıkıştır: scale > 1 yakınlaştırır, < 1 uzaklaştırır; merkez x,y (varsayılan ekran ortası).',
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
          `sıkıştırıldı (×${scale})`,
        );
      },
    ),
    type_text: tool(
      'Yaz',
      'appdyno: odaktaki alana yaz. ref verilirse önce o alana dokunur ve odağı bekler; replace: alanın metnini değiştirir; submit: sonra enter. Türkçe karakterler desteklenir.',
      z.object({ device: Device, ...TypeStep.omit({ action: true }).shape, read: Read }).strict(),
      ACT,
      async ({ device, read, ...a }) =>
        one(await ctx.session(device), { action: 'type_text', ...a }, read),
    ),
    press_key: tool(
      'Tuşa bas',
      'appdyno: tuşa bas: back, enter, home (sunucu kapattıysa kapalı), delete, tab.',
      z.object({ device: Device, key: Keys, read: Read }).strict(),
      ACT,
      async ({ device, key, read }) =>
        one(await ctx.session(device), { action: 'press_key', key }, read),
    ),
    steps: tool(
      'Adımlar',
      `appdyno: bilinen bir diziyi (giriş, form doldurma) tek çağrıda uygula, en fazla ${MAX_STEPS} adım; her adım { action: tap | long_press | swipe | type_text | press_key, ... }. Bir ref adımından önce ekran yeniden okunur; ilk hatada durur. Sonda tek okuma.`,
      z.object({ device: Device, steps: z.array(Step).min(1).max(MAX_STEPS), read: Read }).strict(),
      ACT,
      async ({ device, steps, read }) => {
        const s = await ctx.session(device);
        const refs = steps.flatMap((st) => ('ref' in st && st.ref ? [st.ref] : []));
        if (refs.length > 0) {
          const screen = await s.current();
          const unknown = refs.filter((r) => !screen.list.some((e) => e.ref === r));
          if (unknown.length > 0)
            throw new ToolError(`${STALE}: ${[...new Set(unknown)].join(', ')} bu ekranda yok`);
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
            const t = `${done.join('\n')}\n${i + 1}. adım başarısız, kalanlar uygulanmadı: ${e.message}`;
            return reply(t, { ...summary(t), warnings: [e.message] });
          }
        }
        return reply(done.join('\n'), summary(done.join('\n')));
      },
    ),
    dismiss_alert: tool(
      'İzin penceresini yanıtla',
      'appdyno: açık bir sistem izin penceresini (konum, bildirim, kamera…) yanıtla: allow (varsayılan) ya da deny. Uygulamanın kendi pencerelerine dokunmaz.',
      z
        .object({ device: Device, action: z.enum(['allow', 'deny']).default('allow'), read: Read })
        .strict(),
      ACT,
      async ({ device, action, read }) => {
        const s = await ctx.session(device);
        const screen = await s.read();
        const button = alertButton(screen.elements, 'android', action);
        if (!button)
          return reply(
            'açık sistem izin penceresi yok (uygulamanın kendi penceresine dokunulmaz)',
            summary('açık sistem izin penceresi yok'),
          );
        return act(
          s,
          read,
          (o) => s.device.tap(button, o),
          `sistem izin penceresi yanıtlandı: ${JSON.stringify(button.label)}`,
        );
      },
    ),
    open_link: tool(
      'Link aç',
      'appdyno: bir linki (https:// ya da uygulama şeması) aç ve açılan ekranı döndür; seçili uygulama varsa link onda açılır.',
      z.object({ device: Device, url: z.string().min(3).max(2_000), read: Read }).strict(),
      ACT,
      async ({ device, url, read }) => {
        const s = await ctx.session(device);
        const href = checkUrl(policy, url);
        await s.device.openUrl(href, s.appId).catch(refused);
        return afterChange(s, `açıldı ${href}`, read);
      },
    ),
    launch_app: tool(
      'Uygulamayı başlat',
      'appdyno: uygulamayı başlat (zaten açıksa öne getirir) ve ekranını döndür; app verilmezse seçili uygulama.',
      z.object({ device: Device, app: z.string().max(200).optional(), read: Read }).strict(),
      DESTRUCTIVE,
      async ({ device, app, read }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError('app ver (ya da use_device ile uygulama seç)');
        await s.device.launch(pkg).catch(refused);
        return afterChange(s, `başlatıldı ${pkg}`, read);
      },
    ),
    terminate_app: tool(
      'Uygulamayı kapat',
      'appdyno: uygulamayı durdur (force-stop); app verilmezse seçili uygulama.',
      z.object({ device: Device, app: z.string().max(200).optional() }).strict(),
      DESTRUCTIVE,
      async ({ device, app }) => {
        const s = await ctx.session(device);
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError('app ver (ya da use_device ile uygulama seç)');
        await s.device.terminate(pkg).catch(refused);
        s.acted();
        return reply(`durduruldu ${pkg}`, { done: `durduruldu ${pkg}` });
      },
      DoneOut,
    ),
    set_orientation: tool(
      'Ekran yönü',
      'appdyno: ekran yönü: portrait ya da landscape (yön sabitlenir; sonra portrait’e dön).',
      z
        .object({ device: Device, orientation: z.enum(['portrait', 'landscape']), read: Read })
        .strict(),
      ACT,
      async ({ device, orientation, read }) => {
        const s = await ctx.session(device);
        await s.device.setOrientation(orientation === 'portrait' ? 0 : 1).catch(refused);
        return afterChange(s, `yön: ${orientation}`, read);
      },
    ),
    set_clipboard: tool(
      'Panoya koy',
      'appdyno: panoya bir metin koy (yapıştırma denemeleri için).',
      z.object({ device: Device, text: z.string().min(1).max(2_000) }).strict(),
      ACT,
      async ({ device, text: value }) => {
        if (policy.secrets.some((x) => x && value.includes(x)))
          throw new ToolError('gizli bilgi panoya konmaz');
        const s = await ctx.session(device);
        await s.device.setClipboard(value).catch(refused);
        const done = `panoya kondu (${Array.from(value).length} karakter)`;
        return reply(done, { done });
      },
      DoneOut,
    ),
    set_location: tool(
      'Konum',
      'appdyno: cihazın GPS konumunu sabitle (enlem, boylam).',
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
        const done = `konum: ${lat.toFixed(6)}, ${lon.toFixed(6)}`;
        return reply(done, { done });
      },
      DoneOut,
    ),
    ...perfTools(ctx, ctx.measurementsDir),
  };
  return tools;
}
