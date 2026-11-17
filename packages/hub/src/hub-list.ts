import type {
  DeviceHardware,
  Need,
  Startable,
  ViewerOrder,
  VirtualCatalog,
  VirtualDevices,
} from '@appdyno/core';
import { sleep } from '@appdyno/core';
import type { Platform } from '@appdyno/protocol';
import { checkCreate, liveMirrors, type ServerContext } from '@appdyno/ops';

/** One row of the sidebar. */
export type HubDevice = {
  id: string;
  serial?: string;
  name: string;
  kind: 'phone' | 'simulator' | 'emulator';
  state: 'running' | 'stopped';
  mirrored: boolean;
  platform?: Platform;
  model?: string;
  detail: string;
  /** How a phone is joined to this Mac. */
  link?: 'USB' | 'Wi-Fi';
  /** A row by the network: the phone's serial on its cable, so its cable row gone is no phone gone. */
  sameAs?: string;
  /** What a person has to do before it can show. */
  need?: Need;
};

/** Why a kind has nothing to list or make, in a person's words, and what to do. */
export type Problem = { said: string; fix?: string };

/** A section of the sidebar: each kind this Mac can start is one, empty or not, and says why where it has nothing. */
export type HubKind = { kind: VirtualDevices['kind']; problem?: Problem; waiting?: boolean };

/** A kind's list as last asked: a tool slow to answer leaves what it said before, and is said to be asked still. */
type Listed = { driver: VirtualDevices; found: Startable[]; problem?: Problem; waiting?: boolean };

type Hardware = (serial: string) => Promise<DeviceHardware | undefined>;

/** How long a refresh waits for a kind's tool before it says it waits: simctl's first answer after a boot takes seconds. */
const WAIT_MS = 3_000;
/** What made the last empty list empty, asked again only after this. */
const WHY_EMPTY_MS = 30_000;

/** Where a driver's tools are missing altogether, as its catalog says by having none. */
export const NO_TOOLS: Record<VirtualDevices['kind'], Problem> = {
  simulator: { said: 'Xcode is not installed', fix: 'install Xcode from the App Store' },
  emulator: {
    said: "Android's command-line tools or a system image are missing",
    fix: 'Android Studio, Settings, Android SDK: get the Command-line Tools and a system image',
  },
};

/** A tool that never answered: its own words name a command and a limit, which say nothing to a person. */
export const SLOW: Problem = {
  said: 'The tool that lists them gave no answer in 60 s',
  fix: 'wait, then try again; where it lasts, restart the Mac',
};

/** A refusal said to a person: what failed, and its hint as what to do. */
export const problemOf = (e: unknown): Problem => {
  const { message, hint, code } = e as { message?: string; hint?: string; code?: string };
  if (code === 'TIMEOUT') return SLOW;
  return { said: message ?? String(e), ...(hint && { fix: hint }) };
};

/** What can be made of a kind, or why nothing can. */
export async function catalogOf(driver: VirtualDevices): Promise<VirtualCatalog | Problem> {
  try {
    return (await driver.catalog?.()) ?? NO_TOOLS[driver.kind];
  } catch (e) {
    return problemOf(e);
  }
}

/** Every device this Mac can reach and each virtual one that could start, as a person sees them. */
export async function hubDevices(
  ctx: ServerContext,
  hardware: Hardware,
  lists: Promise<Listed[]> = Promise.all(
    ctx.providers.flatMap(({ virtual: driver }) =>
      driver
        ? [
            driver.startable().then(
              (found) => ({ driver, found }),
              (e: unknown) => ({ driver, found: [], problem: problemOf(e) }),
            ),
          ]
        : [],
    ),
  ),
): Promise<HubDevice[]> {
  // what stands in the hub's own room is the hub's
  const mirrored = new Set(
    liveMirrors()
      .filter((m) => m.pid !== process.pid)
      .map((m) => m.serial),
  );
  // each list is a tool of its own, asked at once
  const [startable, listed] = await Promise.all([lists, ctx.devices()]);
  const virtual: HubDevice[] = startable.flatMap(({ driver, found }) =>
    found.map((d) => ({
      id: d.id,
      ...(d.serial && { serial: d.serial }),
      name: d.name,
      kind: driver.kind,
      state: d.state,
      mirrored: d.serial !== undefined && mirrored.has(d.serial),
      platform: driver.platform,
      ...(d.model && { model: d.model }),
      detail: d.model ?? '',
    })),
  );
  const seen = new Set(virtual.map((d) => d.serial ?? d.id));
  const phones: HubDevice[] = [];
  // a phone whose Wi-Fi went and came back may be found twice by the network, under its name and the same with "(2)"
  const mine = listed.filter((o) => ctx.allowed(o.serial));
  const byNetwork = (phone: string) =>
    mine.find((o) => o.sameAs === phone && o.ready) ?? mine.find((o) => o.sameAs === phone);
  for (const d of listed) {
    // one phone is one row, as it has one encoder: on its cable while it has one, and by the network once it has not
    if (d.sameAs && listed.some((other) => other.serial === d.sameAs)) continue;
    if (d.sameAs && byNetwork(d.sameAs) !== d) continue;
    // what this server may not drive is not even asked of, as asking refuses
    if (seen.has(d.serial) || !ctx.allowed(d.serial)) continue;
    const known = await hardware(d.serial);
    const provider = ctx.providers.findLast((p) => p.handles(d.serial));
    const need = d.ready ? undefined : await provider?.need?.(d).catch(() => undefined);
    phones.push({
      id: d.serial,
      serial: d.serial,
      name: known?.name ?? known?.model ?? d.model ?? d.serial,
      kind: 'phone',
      state: 'running',
      mirrored: mirrored.has(d.serial),
      ...(known?.platform && { platform: known.platform }),
      ...(known?.model && { model: known.model }),
      // said on the row as well as over the device: a person chooses from the list
      detail: d.link === 'Wi-Fi' ? 'Wi-Fi' : '',
      link: d.link ?? 'USB',
      ...(d.sameAs && { sameAs: d.sameAs }),
      ...(need && { need }),
    });
  }
  return [...phones, ...virtual].filter((d) => ctx.allowed(d.serial ?? d.id));
}

/** Why the New sheet makes none, as `checkCreate` refuses it, said to a person. */
export const CREATE_REFUSED =
  'The hub was started with a list of allowed devices, so it makes no new one: start it without --allow-devices to make one.';

/** Where a driver makes none: no window asks this of a kind the sidebar has not, but a message may. */
export const NOTHING_MADE = 'Nothing of this kind can be made on this Mac';

/** What a kind can be made from, asked as its sheet opens: a tool that failed at the hub's start may answer now. */
export async function hubChoices(ctx: ServerContext, kind: string) {
  const driver = ctx.providers.find((p) => p.virtual?.kind === kind)?.virtual;
  if (!driver) return { problem: { said: NOTHING_MADE } };
  const made = await catalogOf(driver);
  // said in the sheet before Create is pressed: the hub's `new` refuses it all the same
  const refused = (() => {
    try {
      checkCreate(ctx.policy);
      return undefined;
    } catch {
      return CREATE_REFUSED;
    }
  })();
  return { ...('said' in made ? { problem: made } : made), ...(refused && { refused }) };
}

/** The sidebar as a window was told it: said again only when it changed. */
export class HubList {
  private readonly known = new Map<string, DeviceHardware | undefined>();
  private told = '';
  private readonly names = new Map<string, string>();
  private readonly asking = new Map<VirtualDevices, Promise<Listed>>();
  private readonly answered = new Map<VirtualDevices, Listed>();
  private readonly whyEmpty = new Map<
    VirtualDevices,
    { at: number; problem: Promise<Problem | undefined> }
  >();

  constructor(
    private readonly ctx: ServerContext,
    private readonly hooks: {
      /** What stands in the room first, for a window that came back. */
      showing(): string | undefined;
      /** A device has a window of its own, which is on its way no more. */
      windowUp(serial: string): void;
      tell(message: ViewerOrder): void;
    },
  ) {}

  private readonly hardware: Hardware = async (serial) => {
    if (!this.known.has(serial))
      this.known.set(
        serial,
        await this.ctx
          .deviceFor(serial)
          .hardware()
          .catch(() => undefined),
      );
    return this.known.get(serial);
  };

  /** An empty list that is no failure may still have a reason: no runtime, or no tools, as the catalog says. */
  private emptyBecause(driver: VirtualDevices) {
    const last = this.whyEmpty.get(driver);
    if (last && Date.now() - last.at < WHY_EMPTY_MS) return last.problem;
    const problem = catalogOf(driver).then((made) => ('said' in made ? made : undefined));
    this.whyEmpty.set(driver, { at: Date.now(), problem });
    return problem;
  }

  /** A kind's list, or the last one and that it is asked still: a slow tool holds no other list up. */
  private async listOf(driver: VirtualDevices): Promise<Listed> {
    let asking = this.asking.get(driver);
    if (!asking) {
      asking = driver.startable().then(
        async (found) => {
          const problem = found.length ? undefined : await this.emptyBecause(driver);
          return { driver, found, ...(problem && { problem }) };
        },
        (e: unknown) => ({ driver, found: [], problem: problemOf(e) }),
      );
      this.asking.set(driver, asking);
    }
    const done = await Promise.race([asking, sleep(WAIT_MS).then(() => undefined)]);
    if (!done) return { ...(this.answered.get(driver) ?? { driver, found: [] }), waiting: true };
    this.asking.delete(driver);
    this.answered.set(driver, done);
    return done;
  }

  /** What the sidebar calls a device: an emulator by its AVD's name, which its own hardware does not know. */
  nameOf(serial: string) {
    return this.names.get(serial);
  }

  /** A new window has been told nothing. */
  forgetTold() {
    this.told = '';
  }

  async refresh() {
    const lists = Promise.all(
      this.ctx.providers.flatMap(({ virtual }) => (virtual ? [this.listOf(virtual)] : [])),
    );
    const devices = await hubDevices(this.ctx, this.hardware, lists);
    const kinds: HubKind[] = (await lists).map(({ driver, problem, waiting }) => ({
      kind: driver.kind,
      ...(problem && { problem }),
      ...(waiting && { waiting }),
    }));
    for (const d of devices) this.names.set(d.serial ?? d.id, d.name);
    for (const d of devices) if (d.mirrored) this.hooks.windowUp(d.serial ?? d.id);
    const text = JSON.stringify({ devices, kinds });
    if (text === this.told) return;
    this.told = text;
    const showing = this.hooks.showing();
    this.hooks.tell({ op: 'hub', devices, kinds, ...(showing && { showing }) });
  }
}
