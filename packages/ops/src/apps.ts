import {
  fold,
  reportProgress,
  SETTINGS_PAGES,
  type Screen,
  type SettingsPage,
} from '@appdyno/core';
import { z } from 'zod';
import type { Answers, ReadMode } from './answers.js';
import type { ServerContext } from './context.js';
import { checkApp, checkUrl } from './policy.js';
import { ActionOut, DoneOut } from './schemas.js';
import type { Session } from './session.js';
import { setCondition } from './settings.js';
import { Read } from './step-schemas.js';
import type { Steps } from './steps.js';
import { ACT, defineOp, DESTRUCTIVE, reply, ToolError } from './tool.js';

const NO_APP = 'give app (or select one with use_device)';
/** An app's id; anything else is what a person calls it. */
const APP_ID = /^[\w-]+(\.[\w-]+)+$/;

/** A language as the systems take it: `tr`, `pt-BR`, `zh-Hans`. */
const Language = z
  .string()
  .refine((v) => /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v), 'a language such as tr or pt-BR');

/** How long the page an app's row is on has to come, and how far down a long list of apps it may be. */
const APPS_PAGE_MS = 5_000;
const APPS_SWIPES = 20;

export function appOps(ctx: ServerContext, { afterChange }: Answers, { one }: Steps) {
  const policy = ctx.policy;

  const appNamed = async (s: Session, name: string) => {
    const same = (await s.device.apps.listApps(true)).filter(
      (a) => a.name && fold(a.name) === fold(name),
    );
    if (same.length === 1) return same[0]!.id;
    if (same.length === 0)
      throw new ToolError(`no app named ${name} here`, 'NOT_FOUND', 'app action list names them');
    throw new ToolError(
      `several apps are named ${name}: ${same.map((a) => a.id).join(', ')}`,
      'INVALID_ARGUMENT',
      'give its id',
    );
  };

  /** What a link did, by the screen it left: iOS asks before a scheme first opens an app, and nothing opens until then. */
  const linkSaid = (s: Session, href: string) => (screen: Screen | undefined) => {
    const asks = screen && s.device.platformScreen.systemAlert(screen.tree, screen.elements);
    if (!asks) return `opened ${href}`;
    const buttons = asks.buttons.map((b) => b.label).join(', ');
    return `sent ${href}, and the system asks: ${asks.texts.join(' ')} (${buttons}): answer it with alert`;
  };

  const openSettings = async (s: Session, settings: string, read: ReadMode) => {
    if (!policy.allowHome)
      throw new ToolError(
        'Settings is off on this server: the app may not be left',
        'POLICY_DENIED',
      );
    const page = SETTINGS_PAGES.find((p): p is SettingsPage => p === settings);
    const app = page
      ? undefined
      : checkApp(policy, settings === 'app' ? (s.appId ?? '') : settings);
    if (!page && !app) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
    if (!page && settings !== 'app' && !settings.includes('.'))
      throw new ToolError(
        `settings: an app's id, app, or a page: ${SETTINGS_PAGES.join(', ')}`,
        'INVALID_ARGUMENT',
      );
    const { row } = await s.device.openSettings(page ? { page } : { app: app! });
    if (!row) return afterChange(s, `opened Settings: ${settings}`, read);
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
        "Open a URL, deep link, universal link or App Link and answer its screen; with an app selected it opens there. settings instead: a page of Settings (about, privacy, wifi…; a wrong word lists them), or an app's own: its id, or app. links: an app's id lists the links it opens.",
      input: z
        .object({
          url: z.string().min(3).max(2_000).optional(),
          settings: z.string().min(1).max(200).optional(),
          links: z.string().min(1).max(200).optional(),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: ACT,
      run: async ({ url, settings, links, read }) => {
        if ([url, settings, links].filter(Boolean).length !== 1)
          throw new ToolError('give url, settings or links', 'INVALID_ARGUMENT');
        const s = await ctx.session();
        if (links) {
          const found = await s.device.apps.links(checkApp(policy, links));
          const t = found.length > 0 ? found.join('\n') : `${links} opens no links`;
          return reply(t, { done: t, screen: 'none', warnings: [] });
        }
        if (settings) return openSettings(s, settings, read);
        const href = checkUrl(policy, url!);
        await s.device.openUrl(href, s.appId);
        return afterChange(s, linkSaid(s, href), read);
      },
    }),
    defineOp({
      name: 'launch_app',
      title: 'Launch app',
      description:
        'Launch the app, by id or name (to the front if it runs); answers its screen. language: tr, pt-BR: restarts it so, until restore.',
      input: z
        .object({
          app: z.string().max(200).optional(),
          language: Language.optional(),
          read: Read,
        })
        .strict(),
      output: ActionOut,
      annotations: DESTRUCTIVE,
      run: async ({ app, language, read }) => {
        const named = app !== undefined && !APP_ID.test(app);
        const s = await (named ? ctx.session() : ctx.sessionToLaunch(app));
        const pkg = checkApp(policy, named ? await appNamed(s, app) : (app ?? s.appId ?? ''));
        if (!pkg) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
        reportProgress(`launching ${pkg}`);
        if (!language) {
          await s.device.launch(pkg);
          return afterChange(s, `launched ${pkg}`, read, true);
        }
        const { apps } = s.device;
        const held = apps.languageStays
          ? await setCondition(s, 'locale', language, pkg)
          : undefined;
        await apps.launchWith(pkg, { language });
        const done = [`launched ${pkg} in ${language}`, held].filter(Boolean).join('; ');
        return afterChange(s, done, read, true);
      },
    }),
    defineOp({
      name: 'terminate_app',
      title: 'Terminate app',
      description: 'Stop the app (force-stop).',
      input: z.object({ app: z.string().max(200).optional() }).strict(),
      output: DoneOut,
      annotations: DESTRUCTIVE,
      run: async ({ app }) => {
        const s = await ctx.session();
        const pkg = checkApp(policy, app ?? s.appId ?? '');
        if (!pkg) throw new ToolError(NO_APP, 'INVALID_ARGUMENT');
        await s.device.terminate(pkg);
        s.acted();
        s.appPid = undefined;
        return reply(`stopped ${pkg}`, { done: `stopped ${pkg}` });
      },
    }),
  ];
}
