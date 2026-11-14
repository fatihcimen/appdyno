import { existsSync } from 'node:fs';
import { deviceState, Owner, type LaunchHolds, type LaunchOptions } from '@appdyno/core';
import { z } from 'zod';
import { launchLanguage } from './manage.js';

const INSERT = 'DYLD_INSERT_LIBRARIES';

/** A probe in an app: the library each launch inserts, and what it reads of its environment. */
const Probe = z.object({ lib: z.string(), env: z.record(z.string(), z.string()) });
export type Probe = z.infer<typeof Probe>;

/** What each launch of an app by this tool carries, by app and then by probe, and who answers for it. */
const Held = z.object({
  apps: z.record(z.string(), z.record(z.string(), Probe)),
  owner: Owner.optional(),
});

/** Kept on this Mac by simulator: nothing on the device holds a launch's environment for an app. */
const held = deviceState('sim-held', Held);

/** Environments, each over the one before but for the libraries each inserts: all of those, each once, in order. */
export function joinEnv(...envs: Record<string, string>[]): Record<string, string> {
  const libs = new Set(envs.flatMap((e) => e[INSERT]?.split(':').filter(Boolean) ?? []));
  const { [INSERT]: _, ...rest } = Object.assign({}, ...envs) as Record<string, string>;
  return libs.size > 0 ? { ...rest, [INSERT]: [...libs].join(':') } : rest;
}

/** What a launch of `app` by this tool carries: its language, the probes held in it, then what the launch adds. */
export function heldLaunch(udid: string, app: string, own: LaunchOptions = {}) {
  // a library gone from this Mac would end the app as it starts
  const probes = Object.values(held.read(udid)?.apps[app] ?? {}).filter((p) => existsSync(p.lib));
  return {
    args: [...launchLanguage(udid, app, own.language), ...(own.args ?? [])],
    env: joinEnv(...probes.map((p) => ({ ...p.env, [INSERT]: p.lib })), own.env ?? {}),
  };
}

/** The probes held in a simulator's apps: each put in by what reads it, all let go as a session's conditions are. */
export class HeldLaunches implements LaunchHolds {
  owner: Owner | undefined;

  constructor(private readonly udid: string) {}

  /** `probe` goes into each launch of `app` by this tool from now on; the newest holder answers for all of them. */
  hold(app: string, name: string, probe: Probe) {
    held.update(this.udid, (now) => ({
      apps: { ...now?.apps, [app]: { ...now?.apps[app], [name]: probe } },
      ...(this.owner && { owner: this.owner }),
    }));
  }

  drop(app: string, name: string) {
    held.update(this.udid, (now) => {
      const { [name]: _, ...left } = now?.apps[app] ?? {};
      const { [app]: __, ...others } = now?.apps ?? {};
      const apps = Object.keys(left).length > 0 ? { ...now?.apps, [app]: left } : others;
      return now && Object.keys(apps).length > 0 ? { ...now, apps } : undefined;
    });
  }

  holder() {
    const now = held.read(this.udid);
    return now && { owner: now.owner };
  }

  letGo() {
    const now = held.read(this.udid);
    held.remove(this.udid);
    return Object.entries(now?.apps ?? {}).flatMap(([app, probes]) =>
      Object.keys(probes).map((name) => `the ${name} probe in ${app}`),
    );
  }
}
