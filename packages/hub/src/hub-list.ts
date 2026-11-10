import type { DeviceHardware, Need, Startable, ViewerOrder } from '@appdyno/core';
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

type Hardware = (serial: string) => Promise<DeviceHardware | undefined>;

/** Every device this Mac can reach and each virtual one that could start, as a person sees them. */
export async function hubDevices(ctx: ServerContext, hardware: Hardware): Promise<HubDevice[]> {
  // what stands in the hub's own room is the hub's
  const mirrored = new Set(
    liveMirrors()
      .filter((m) => m.pid !== process.pid)
      .map((m) => m.serial),
  );
  // each list is a tool of its own, asked at once
  const [startable, listed] = await Promise.all([
    Promise.all(
      ctx.providers.flatMap(({ virtual: driver }) =>
        driver
          ? [
              driver
                .startable()
                .catch(() => [] as Startable[])
                .then((found) => ({ driver, found })),
            ]
          : [],
      ),
    ),
    ctx.devices(),
  ]);
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

/** What each kind can be made from: asked once, as each list is a tool's slow answer. */
async function hubChoices(ctx: ServerContext) {
  const choices: Record<string, unknown> = {};
  // said in the sheet before Create is pressed: the hub's `new` refuses it all the same
  const refused = (() => {
    try {
      checkCreate(ctx.policy);
      return undefined;
    } catch {
      return CREATE_REFUSED;
    }
  })();
  for (const { virtual } of ctx.providers) {
    const made = await virtual?.catalog?.().catch(() => undefined);
    if (virtual && made) choices[virtual.kind] = { ...made, ...(refused && { refused }) };
  }
  return choices;
}

/** The sidebar as a window was told it: said again only when it changed. */
export class HubList {
  private readonly known = new Map<string, DeviceHardware | undefined>();
  private readonly choices: Promise<Record<string, unknown>>;
  private told = '';
  private readonly names = new Map<string, string>();

  constructor(
    private readonly ctx: ServerContext,
    private readonly hooks: {
      /** What stands in the room first, for a window that came back. */
      showing(): string | undefined;
      /** A device has a window of its own, which is on its way no more. */
      windowUp(serial: string): void;
      tell(message: ViewerOrder): void;
    },
  ) {
    this.choices = hubChoices(ctx);
  }

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

  /** What the sidebar calls a device: an emulator by its AVD's name, which its own hardware does not know. */
  nameOf(serial: string) {
    return this.names.get(serial);
  }

  /** A new window has been told nothing. */
  forgetTold() {
    this.told = '';
  }

  async refresh() {
    const devices = await hubDevices(this.ctx, this.hardware);
    for (const d of devices) this.names.set(d.serial ?? d.id, d.name);
    for (const d of devices) if (d.mirrored) this.hooks.windowUp(d.serial ?? d.id);
    const text = JSON.stringify(devices);
    if (text === this.told) return;
    this.told = text;
    const showing = this.hooks.showing();
    this.hooks.tell({
      op: 'hub',
      devices,
      choices: await this.choices,
      ...(showing && { showing }),
    });
  }
}
