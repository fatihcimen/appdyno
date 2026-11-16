import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  buildScreen,
  KEYBOARD_REF,
  ORIENTATIONS,
  otherHosts,
  rotationOf,
  type Device as Driven,
  type ScreenOptions,
} from '@appdyno/core';
import {
  CALL_LINK,
  checkApp,
  checkUrl,
  inside,
  redactLog,
  type Policy as ToolPolicy,
} from '@appdyno/ops';
import {
  AUDIT_TYPES,
  DeviceError,
  type AuditType,
  type Traversal,
  type Tree,
} from '@appdyno/protocol';
import type { Device, DeviceWindow, Screen, Touched, TouchOptions } from './device-types.js';

/** What the members here are made of: the driver's device, the program's policy, and how this entry reads a screen. */
export type Opened = {
  device: Driven;
  policy: ToolPolicy;
  /** The app the device was opened for. */
  app: string | undefined;
  reads: ScreenOptions;
  clean: (text: string) => string;
  shown: (tree: Tree, traversal?: Traversal[]) => Screen;
  screen: () => Promise<Screen>;
  /** The screen come to rest after what replaces it, as a launch or a link. */
  rested: (options?: TouchOptions) => Promise<Touched>;
  letGo: () => void;
};

/** A window's kind, by Android's number for it, which an iPhone's read gives too. */
const WINDOW_TYPES: Record<number, DeviceWindow['type']> = {
  1: 'app',
  2: 'keyboard',
  3: 'system',
  4: 'overlay',
};

const LINES = { given: 200, most: 1_000 };

const wrong = (message: string, hint?: string) =>
  new DeviceError('INVALID_ARGUMENT', message, hint);

/** The kinds of issue an audit was asked for, said here where one is none. */
function auditTypes(given: string[] | undefined): AuditType[] | undefined {
  const known = (t: string): t is AuditType => (AUDIT_TYPES as readonly string[]).includes(t);
  if (given === undefined || given.every(known)) return given;
  throw wrong(`an audit's types are of ${AUDIT_TYPES.join(', ')}`);
}

/** What a device does beside reading and touching: its picture, its logs, its links, its windows and its agent. */
export function membersOf({
  device,
  policy,
  app,
  reads,
  clean,
  shown,
  screen,
  rested,
  letGo,
}: Opened): Pick<
  Device,
  | 'screenshot'
  | 'logs'
  | 'openLink'
  | 'windows'
  | 'setOrientation'
  | 'audit'
  | 'clearData'
  | 'stopAgent'
> {
  const { serial } = device;
  return {
    screenshot: (async ({ path, ...given }: { path?: string } = {}) => {
      // refused before anything is asked of the device
      const to = path === undefined ? undefined : inside(policy, path);
      const { meta, data } = await device.screenshot({ format: 'png', ...given });
      const shot = { format: meta.format, width: meta.w, height: meta.h };
      if (to === undefined) return { ...shot, data };
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, data);
      return { ...shot, path: to };
    }) as Device['screenshot'],
    async logs({ since, level = 'info', maxLines = LINES.given, ...q } = {}) {
      const of = q.app ?? app;
      if (!of) throw wrong('logs takes an app', 'give app, or open the device with one');
      if (!Number.isInteger(maxLines) || maxLines < 1 || maxLines > LINES.most)
        throw wrong(`maxLines is a whole number from 1 to ${LINES.most}`);
      const read = await device.logs({
        app: checkApp(policy, of),
        level,
        maxLines,
        timed: true,
        ...(since !== undefined && { since }),
      });
      // the newest as many as asked: a driver may give every line since a time, or more than it was asked for
      const { source, note } = read;
      const [lines, marks] = [read.lines.slice(-maxLines), read.marks?.slice(-maxLines)];
      return {
        lines: lines.map((line, n) => {
          const mark = marks?.[n];
          return {
            text: redactLog(policy, line),
            ...(mark && { at: mark.at }),
            ...(mark?.level && { level: mark.level }),
          };
        }),
        source,
        ...(note && { note }),
      };
    },
    async openLink(url, { app: into, ...o } = {}) {
      const href = checkUrl(policy, url, device.platform);
      if (CALL_LINK.test(href) && !policy.urls)
        throw new DeviceError(
          'POLICY_DENIED',
          'a link that places a call is opened only where policy.urls names it',
        );
      if (into !== undefined) checkApp(policy, into);
      if (policy.apps.length > 0) {
        // as the device tells before the link is sent, or not at all
        const opener = await device.apps.opener(href, into);
        if (!opener || !policy.apps.includes(opener))
          throw new DeviceError(
            'POLICY_DENIED',
            opener
              ? `the link opens in ${opener}, not an app of policy.apps`
              : 'this device cannot tell that the link opens in an app of policy.apps',
          );
      }
      await device.openUrl(href, into);
      return rested(o);
    },
    async windows() {
      const tree = await device.tree();
      const keyboard = buildScreen(tree, reads).list.find((e) => e.ref === KEYBOARD_REF)?.rect;
      return {
        windows: tree.windows.map(({ type, pkg, layer, active, focused, b: [l, t, r, b] }) => ({
          type: WINDOW_TYPES[type] ?? 'other',
          ...(pkg && { pkg }),
          rect: { x: l, y: t, width: r - l, height: b - t },
          layer,
          active,
          focused,
        })),
        // open, and the device says where
        ...(keyboard && keyboard.height > 0 && { keyboard }),
      };
    },
    async setOrientation(orientation) {
      if (!ORIENTATIONS.includes(orientation))
        throw wrong(`an orientation is one of ${ORIENTATIONS.join(', ')}`);
      await device.setOrientation(rotationOf(orientation, device.platform, device.hello?.screen));
    },
    async audit({ types, maxIssues } = {}) {
      const asked = auditTypes(types);
      const r = await device.audit({
        ...(asked && { types: asked }),
        ...(maxIssues !== undefined && { maxIssues }),
      });
      // the read the checks ran on, where the device gives it, with what it tells of the order
      const { elements } = r.read ? shown(r.read.tree, r.read.traversal) : await screen();
      return {
        issues: r.issues.map(({ type, rule, message, element, b }) => {
          const words = element?.t ?? element?.d;
          return {
            type,
            rule,
            message: clean(message),
            ...(words && { label: clean(words) }),
            ...(b && { rect: { x: b[0], y: b[1], width: b[2] - b[0], height: b[3] - b[1] } }),
          };
        }),
        truncated: r.truncated,
        elements,
        order: elements
          .flatMap((e) => (e.order === undefined ? [] : [{ ref: e.ref, at: e.order }]))
          .sort((a, b) => a.at - b.at)
          .map((e) => e.ref),
      };
    },
    async clearData(id) {
      if (!device.virtual)
        throw new DeviceError(
          'UNSUPPORTED',
          `${serial} is a phone: clearData clears an app on an emulator or a simulator alone`,
        );
      await device.apps.clearData(checkApp(policy, id));
    },
    async stopAgent({ force = false } = {}) {
      const [other] = otherHosts(serial);
      if (other && !force)
        throw new DeviceError(
          'AGENT_CONFLICT',
          `pid ${other.pid} uses the agent on ${serial}`,
          'close that process first, or stop it under it with force: true',
        );
      await device.stopAgent();
      letGo();
    },
  };
}
