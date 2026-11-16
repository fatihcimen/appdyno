import {
  fold,
  INSTALLED_APPS,
  must,
  onLine,
  reportProgress,
  type AppLink,
  type Screen,
} from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { z } from 'zod';
import type { Answers, ReadMode } from './answers.js';
import { systemAsks } from './noticed.js';
import type { ServerContext } from './context.js';
import { approveLink, approvePower } from './approval.js';
import {
  APP_ID,
  byPerson,
  CALL_LINK,
  checkApp,
  checkLaunch,
  checkSettings,
  checkUrl,
  noApp,
  noSettings,
  schemeOf,
  SETTINGS_LINK,
  WEB_LINK,
  type Policy,
} from './policy.js';
import { ActionOut, DoneOut } from './schemas.js';
import type { Session } from './session.js';
import { askLanguage } from './power.js';
import { setCondition } from './settings.js';
import { Read } from './step-schemas.js';
import type { Steps } from './steps.js';
import { ACT, beyond, defineOp, definePart, DESTRUCTIVE, reply, ToolError } from './tool.js';

/** The app the device says the link opens in, held to `app`; none where it cannot tell. */
const openerOf = async (s: Session, href: string, app: string) => {
  try {
    return await s.device.apps.opener(href, app);
  } catch {
    return undefined;
  }
};

/** What the app says it opens; none where the device cannot tell, which asks as an app that declares none does. */
const linksOf = async (s: Session, app: string) => {
  try {
    return await s.device.apps.links(app);
  } catch {
    return [];
  }
};

/**
 * A link that is no web page opens unasked where the person's own list has it, where an allowed app is what the device
 * says opens it, and where the selected app says it opens that scheme or the device sends the link to that app alone. Any other asks the person: the scheme decides
 * what takes it, and what no app here declared is the system's or another app's to act on.
 */
async function askOfScheme(policy: Policy, s: Session, href: string, app: string | undefined) {
  const listed = policy.urls !== undefined || policy.apps.length > 0;
  if (listed || WEB_LINK.test(href) || SETTINGS_LINK.test(href) || CALL_LINK.test(href)) return;
  const scheme = must(schemeOf(href), 'its scheme');
  if (!app) return approveLink(s, href, scheme, app);
  // a device that sends a link to the app it names and to no other, as an iPhone, has said what takes it
  const held = await openerOf(s, href, app);
  const declared = held === app ? [] : await linksOf(s, app);
  if (held === app || declared.some((l) => schemeOf(l.url) === scheme)) return;
  await approveLink(s, href, scheme, app);
}

/** A link an app says it opens, as a line: an app wrote its filters, so they stay on that line. */
const linkLine = (l: AppLink) =>
  `${l.kind} ${onLine(l.url)}${l.state ? `: ${onLine(l.state)}` : ''}`;

/** With `links`, each link the app opens, as its lines say. */
const LinkOut = ActionOut.extend({
  links: z
    .array(
      z.object({
        url: z.string(),
        kind: z.enum(['scheme', 'domain', 'filter']),
        state: z.string().optional(),
      }),
    )
    .optional(),
});
/**
 * What a launch did, by whether the app ran before it (undefined: not known). `restarts`: the launch stops a running
 * app first, where another brings it to the front as it was.
 */
export const launchSaid = (pkg: string, ran: boolean | undefined, restarts = false) =>
  ran === undefined
    ? `launched ${pkg}`
    : !ran
      ? `started ${pkg}`
      : restarts
        ? `restarted ${pkg}, which was running`
        : `brought ${pkg} to the front, on the screen it was on`;

/** A language as the systems take it: `tr`, `pt-BR`, `zh-Hans`. */
const Language = z
  .string()
  .refine((v) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v), 'a language such as tr or pt-BR');

/** How long the page an app's row is on has to come, and how far down a long list of apps it may be. */
const APPS_PAGE_MS = 5_000;
const APPS_SWIPES = 20;

/** How long a link's screen has to hold still: an app it starts, as an action's settle allows 3 s. */
const LINK_SETTLE_MS = 5_000;

export function appOps(ctx: ServerContext, { changing, afterChange }: Answers, { one }: Steps) {
  const policy = ctx.policy;

  const appNamed = async (s: Session, name: string) => {
    const same = (await s.device.apps.listApps(true)).filter(
      (a) => a.name && fold(a.name) === fold(name),
    );
    const [only, other] = same;
    if (only && !other) return only.id;
    if (!only)
      throw new ToolError(`no app named ${name} here`, 'NOT_FOUND', 'manage_app list names them');
    throw new ToolError(
      `several apps are named ${name}: ${same.map((a) => a.id).join(', ')}`,
      'INVALID_ARGUMENT',
      'give its id',
    );
  };

  /** A launch that failed for an app the device does not have says so, by the same code on every platform. */
  const notThere = (s: Session, pkg: string) => async (e: unknown) => {
    if ((await s.device.apps.appState(pkg).catch(() => undefined)) === 'not_installed')
      throw new ToolError(
        `${pkg} is not installed on ${s.device.serial}`,
        'NOT_FOUND',
        INSTALLED_APPS,
      );
    throw e;
  };

  /**
   * What a link did, by the screen it left: iOS asks before a scheme first opens an app, and nothing opens until then.
   * `answered`: the app whose "Open in …?" the device answered on the way.
   */
  const linkSaid =
    (s: Session, href: string, answered?: string, notIn?: string) =>
    (screen: Screen | undefined) => {
      const asks = screen && s.device.platformScreen.systemAlert(screen.tree, screen.elements);
      if (asks) return `sent ${href}, and ${systemAsks(asks)}`;
      return `opened ${href}${notIn ? ` in another app: ${notIn} does not open it` : ''}${answered ? `, answering the system's "Open in …?" for ${answered} on the way` : ''}`;
    };

  /**
   * A link sent held to `app`; with no allowlist, a web link the app does not open goes to whatever does, a browser,
   * and the app is left on purpose. `notIn`: the app it was not held to then.
   */
  const openIn = async (s: Session, href: string, app: string | undefined) => {
    try {
      return { result: await s.device.openUrl(href, app) };
    } catch (e) {
      if (!(e instanceof DeviceError) || e.code !== 'NOT_FOUND') throw e;
      const held = new DeviceError(
        e.code,
        e.message,
        e.hint ?? `open_link with links: ${app ?? "an app's id"} lists the links it opens`,
      );
      if (!app || !/^https?:/i.test(href) || policy.apps.length > 0) throw held;
      // what no app opens is said as the app's refusal
      const result = await s.device.openUrl(href).catch(() => Promise.reject(held));
      s.leftTheApp();
      return { result, notIn: app };
    }
  };

  /** Under --allow-apps a link opens in an allowed app, as the device tells before it is sent, or not at all. */
  const linkApp = async (s: Session, href: string) => {
    // Settings' own links are Settings', which checkUrl has held to the list
    if (policy.apps.length === 0 || SETTINGS_LINK.test(href)) return s.appId;
    const held = s.appId ?? (policy.apps.length === 1 ? policy.apps[0] : undefined);
    const opener = await s.device.apps.opener(href, held);
    if (opener && policy.apps.includes(opener)) return opener;
    throw new ToolError(
      opener
        ? `the link opens in ${opener}, not an allowed app (${policy.apps.join(', ')})`
        : held
          ? `${held} declares no link like this (open_link links: lists its links), so it may open in another app`
          : `this device cannot tell that the link opens in an allowed app (${policy.apps.join(', ')})`,
      'POLICY_DENIED',
      `${held ? '' : 'use_device with app selects the allowed app it is for; '}${byPerson(
        opener ? `by adding ${opener} to --allow-apps` : 'by --allow-apps',
      )}`,
    );
  };

  const openSettings = async (s: Session, settings: string, read: ReadMode) => {
    if (!policy.allowHome) throw noSettings();
    const page = s.device.settingsPages.find((p) => p === settings);
    if (!page && settings !== 'app' && !settings.includes('.'))
      throw new ToolError(
        `settings: an app's id, app, or a page of this device's Settings: ${s.device.settingsPages.join(', ')}`,
        'INVALID_ARGUMENT',
      );
    const app = page
      ? undefined
      : checkApp(policy, settings === 'app' ? (s.appId ?? '') : settings);
    if (!page && !app) throw noApp();
    checkSettings(policy, s.device.platform);
    s.leftTheApp();
    const {
      result: { row },
      was,
    } = await changing(s, () =>
      s.device.openSettings(page ? { page } : { app: must(app, "the app's id") }),
    );
    if (!row) return afterChange(s, was, `opened Settings: ${settings}`, read);
    s.acted();
    const selector = { text: row };
    await s.until((x) => x.list.length > 0, APPS_PAGE_MS);
    await one(
      s,
      { action: 'scroll_to', selector, direction: 'up', maxSwipes: APPS_SWIPES },
      'none',
    );
    return one(s, { action: 'tap', selector }, read);
  };

  return [
    defineOp({
      name: 'open_link',
      title: 'Open link',
      description:
        "Open a URL, deep link, universal link or App Link, in the selected app if any. settings: a Settings page (about, privacy…; a wrong word lists this device's), or an app's: its id, or app. links: an app's id lists the links it opens. An app by id: launch_app. Returns the screen after.",
      input: z
        .object({
          url: z.string().min(3).max(2_000).optional(),
          settings: z.string().min(1).max(200).optional(),
          links: z.string().min(1).max(200).optional(),
          read: Read,
        })
        .strict(),
      output: LinkOut,
      // a link may be a page on the web
      annotations: beyond(ACT),
      run: async ({ url, settings, links, read }) => {
        if ([url, settings, links].filter(Boolean).length !== 1)
          throw new ToolError('give url, settings or links', 'INVALID_ARGUMENT');
        const s = await ctx.session();
        if (links) {
          const found = await s.device.apps.links(checkApp(policy, links));
          const t = found.map(linkLine).join('\n') || `${links} opens no links`;
          return reply(t, { done: t, screen: 'none', warnings: [], links: found });
        }
        if (settings) return openSettings(s, settings, read);
        const href = checkUrl(policy, must(url, 'url'), s.device.platform);
        const app = await linkApp(s, href);
        await askOfScheme(policy, s, href, app);
        if (CALL_LINK.test(href))
          await approvePower(policy, s, `the link ${href}, which places a call`);
        // a web link that no app holds goes to a browser, which the device puts in front a moment after it took the
        // link: the screen the link left, still and unchanged, is no answer yet
        const from = /^https?:/i.test(href)
          ? (await s.current().catch(() => undefined))?.hash
          : undefined;
        const {
          result: { result, notIn },
          was,
        } = await changing(s, () => openIn(s, href, app));
        const answered = typeof result === 'object' ? result.answered : undefined;
        const arrived = {
          met: (x: Screen) => x.hash !== from,
          otherwise: 'the screen is still the one the link was sent from',
        };
        // a link may start its app, which goes on drawing for seconds after it is in front: 3 s left it moving, at load
        return afterChange(
          s,
          was,
          linkSaid(s, href, answered, notIn),
          read,
          undefined,
          from !== undefined && (!app || notIn) ? arrived : undefined,
          LINK_SETTLE_MS,
        );
      },
    }),
    launchOp(ctx, { changing, afterChange }, { appNamed, notThere }),
    definePart({
      name: 'terminate_app',
      input: z
        .object({ app: z.string().max(200).optional(), background: z.boolean().optional() })
        .strict(),
      output: DoneOut,
      annotations: DESTRUCTIVE,
      run: async ({ app, background }) => {
        const s = await ctx.session();
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw noApp();
        if (background) return endInBackground(s, pkg);
        await s.device.terminate(pkg);
        if (pkg === s.appId) s.leftTheApp();
        s.acted();
        s.forgetProcess();
        return reply(`stopped ${pkg}`, { done: `stopped ${pkg}` });
      },
    }),
  ];
}

/** manage_app stop with background: home, then the app's end as the system makes one, where the device can make it. */
async function endInBackground(s: Session, pkg: string) {
  if (!s.device.endInBackground)
    throw new ToolError(
      'this device cannot end an app in the background as the system does',
      'UNSUPPORTED',
      'manage_app stop without background stops it, as a person does',
    );
  const said = await s.device.endInBackground(pkg);
  s.leftTheApp();
  s.acted();
  s.forgetProcess();
  const t = [`ended ${pkg} in the background, as the system does for memory`, said]
    .filter(Boolean)
    .join('; ');
  return reply(t, { done: t });
}

/** How long a probe stays in an app's launches: a command line's hold is no session's, and ends by another's hand. */
const probeStays = (s: Session) =>
  s.owner
    ? 'until the session ends'
    : 'until restore, or until a server that holds probes on this device ends';

/** launch_app: a launch, to the front where the app runs, or a fresh start with what it is to start with. */
function launchOp(
  ctx: ServerContext,
  { changing, afterChange }: Pick<Answers, 'changing' | 'afterChange'>,
  {
    appNamed,
    notThere,
  }: {
    appNamed: (s: Session, name: string) => Promise<string>;
    notThere: (s: Session, pkg: string) => (e: unknown) => Promise<never>;
  },
) {
  const policy = ctx.policy;
  return defineOp({
    name: 'launch_app',
    title: 'Launch app',
    description:
      'Launch an app by its id or the name manage_app list gives, to the front on the screen it was on if it runs. restart: start it fresh, as args (Android: key=value extras), env and language (tr, pt-BR) do. probe: with the view probe read_screen views reads. By URL: open_link; to stop it: manage_app. Returns the screen after.',
    input: z
      .object({
        app: z.string().max(200).optional(),
        restart: z.boolean().optional(),
        args: z.array(z.string().max(500)).max(50).optional(),
        env: z.record(z.string(), z.string().max(1_000)).optional(),
        language: Language.optional(),
        probe: z.boolean().optional(),
        read: Read,
      })
      .strict(),
    output: ActionOut,
    annotations: DESTRUCTIVE,
    run: async ({ app, restart, args, env, language, probe, read }) => {
      const named = app !== undefined && !APP_ID.test(app);
      const s = await ctx.sessionToLaunch(app, { restart, args, env, language, probe });
      const pkg = checkApp(policy, named ? await appNamed(s, app) : (app ?? s.appId ?? ''));
      if (!pkg) throw noApp();
      checkLaunch(policy, pkg);
      const { apps } = s.device;
      // a device that reads its views with no probe launches as asked, so that one call serves either platform
      const unneeded = probe && !apps.viewProbe && !!s.device.views;
      if (probe && !apps.viewProbe && !unneeded)
        throw new ToolError(
          'this device puts no view probe in an app',
          'UNSUPPORTED',
          'read_screen views reads the views where a device gives them without one; read_screen reads the accessibility tree',
        );
      const withProbe = probe && !unneeded;
      const noProbe =
        unneeded && 'this device reads its views without a probe: read_screen views needs none';
      if (language) await askLanguage(policy, s, language, pkg);
      reportProgress(`launching ${pkg}`);
      s.leftTheApp(pkg !== s.appId);
      const ran = await ctx.ranBeforeLaunch(s, pkg);
      if (!restart && !args && !env && !language && !withProbe) {
        const { was } = await changing(s, () => s.device.launch(pkg).catch(notThere(s, pkg)));
        const said = [launchSaid(pkg, ran), noProbe].filter(Boolean).join('; ');
        const out = await afterChange(s, was, said, read, pkg);
        // a recording writes a start as a start, so that its replay starts where this did
        return ran === undefined ? out : { ...out, data: { ...out.data, wasRunning: ran } };
      }
      const held =
        language && apps.languageStays
          ? (await setCondition(s, 'locale', language, pkg)).also
          : undefined;
      // every platform's launch with these stops a running app first
      const { was } = await changing(s, () =>
        apps
          .launchWith(pkg, {
            ...(args && { args }),
            ...(env && { env }),
            ...(language && { language }),
            ...(withProbe && { probe }),
          })
          .catch(notThere(s, pkg)),
      );
      const done = [
        language ? `started ${pkg} in ${language}` : launchSaid(pkg, ran, true),
        held,
        withProbe && `with the view probe in it, kept in its launches ${probeStays(s)}`,
        noProbe,
      ]
        .filter(Boolean)
        .join('; ');
      // the system's launch returns as the app starts, and the screen shows its switcher's picture of it a while
      const front = {
        met: (x: Screen) => x.foreground === pkg,
        otherwise: `${pkg} is not in front yet`,
      };
      return afterChange(s, was, done, read, pkg, front);
    },
  });
}
