import { z } from 'zod';
import type { Pieces } from '../catalog.js';
import { mergeOp } from '../merge.js';
import { beyond, DESTRUCTIVE } from '../tool.js';

export const manageApp = ({ app, terminate_app: stop }: Pick<Pieces, 'app' | 'terminate_app'>) =>
  mergeOp({
    name: 'manage_app',
    title: 'Manage apps',
    description:
      'Install and manage apps: list (all: system apps too), state, install (path: .apk, .app, .ipa; files: an .apk with its .dm or split APKs), uninstall, stop (background: as the system ends it, state kept), clear (data), grant, revoke (service: location, photos…; a wrong word lists them), build_and_run (path: Xcode project or Gradle folder; scheme or module; configuration or variant; args, env). Starting one: launch_app; its data: transfer_files. Returns what was done.',
    input: z
      .object({
        action: z.enum(
          [...app.input.shape.action.exclude(['download_data', 'replace_data']).options, 'stop'],
          {
            // what a caller reaches for here, and where it is
            error: (x) =>
              x.input === 'launch'
                ? 'manage_app has no launch: launch_app starts an app, and with restart: true starts it fresh'
                : undefined,
          },
        ),
        ...app.input.omit({ action: true }).shape,
        ...stop.input.shape,
      })
      .strict(),
    // a project's build fetches what the project names
    annotations: beyond(DESTRUCTIVE),
    parts: [app, stop],
    pick: ({ action, background, ...a }) =>
      action === 'stop' ? [stop, { ...a, background }] : [app, { ...a, action, background }],
  });

export const transferFiles = ({
  app,
  device_setting: setting,
}: Pick<Pieces, 'app' | 'device_setting'>) =>
  mergeOp({
    name: 'transfer_files',
    title: 'Transfer files',
    description:
      "File transfer between this Mac and the device. pull: download an app's data to the folder path. push: upload the folder path as its data, replacing it (stops the app; asks the person). media: add the photos or videos at path to the gallery, taken out at the session end. An .apk or .ipa: manage_app install. Returns what moved, and where.",
    input: z
      .object({
        action: z.enum(['pull', 'push', 'media']),
        path: z.string().max(1_000),
        app: app.input.shape.app,
      })
      .strict(),
    annotations: DESTRUCTIVE,
    parts: [app, setting],
    pick: ({ action, path, app: id }) =>
      action === 'media'
        ? [setting, { name: 'media', value: path, app: id }, { value: 'path' }]
        : [app, { action: action === 'pull' ? 'download_data' : 'replace_data', path, app: id }],
  });

const INSIDE = ['web', 'rn', 'ax'] as const;

export const inspectApp = ({
  webview: web,
  react_native: rn,
  inspector: ax,
}: Pick<Pieces, 'webview' | 'react_native' | 'inspector'>) =>
  mergeOp({
    name: 'inspect_app',
    title: 'Inside an app',
    description:
      "Reach inside an app where read_screen cannot: a web view, React Native, or an iPhone with no runner. Web view of a debuggable app: web_pages, web_elements (the DOM, at tap coordinates), web_click (selector: CSS), web_eval (js); page: id or part of a title or URL. Metro: rn_targets, rn_logs (the JS console for ms), rn_reload. The iPhone's accessibility service: ax_list, ax_press (name). Returns the listing, or what was done.",
    input: z
      .object({
        action: z.enum([
          'web_pages',
          'web_elements',
          'web_click',
          'web_eval',
          'rn_targets',
          'rn_logs',
          'rn_reload',
          'ax_list',
          'ax_press',
        ]),
        ...web.input.pick({ app: true }).shape,
        ...web.input.omit({ action: true }).shape,
        ...rn.input.omit({ action: true }).shape,
        ...ax.input.omit({ action: true }).shape,
      })
      .strict(),
    // a web view's page is the web's, and a script in it reaches what the page can
    annotations: beyond(DESTRUCTIVE),
    parts: [web, rn, ax],
    // an action is its part's own word behind what it reaches into
    pick: ({ action, ...a }) => {
      const inside = INSIDE.findIndex((word) => action.startsWith(`${word}_`));
      const part = ([web, rn, ax] as const)[inside] ?? web;
      return [part, { ...a, action: action.slice(action.indexOf('_') + 1) }];
    },
  });
