import type { DeviceHardware, Need, Startable, ViewerOrder } from '@appdyno/core';
import type { Platform } from '@appdyno/protocol';
import { liveMirrors, type ServerContext } from '@appdyno/ops';

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
  const virtual: HubDevice[] = [];
  for (const { virtual: driver } of ctx.providers) {
    const found = await driver?.startable().catch(() => [] as Startable[]);
    for (const d of found ?? [])
      virtual.push({
        id: d.id,
        ...(d.serial && { serial: d.serial }),
        name: d.name,
        kind: driver!.kind,
        state: d.state,
        mirrored: d.serial !== undefined && mirrored.has(d.serial),
        platform: driver!.platform,
        ...(d.model && { model: d.model }),
        detail: d.model ?? '',
      });
  }
  const seen = new Set(virtual.map((d) => d.serial ?? d.id));
  const phones: HubDevice[] = [];
  for (const d of await ctx.devices()) {
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
      detail: '',
      // shortcut: an address names Wi-Fi on Android, and an iPhone here always reads USB; ask its own transport when one says
      link: d.state === 'network' || d.serial.includes(':') ? 'Wi-Fi' : 'USB',
      ...(need && { need }),
    });
  }
  return [...phones, ...virtual].filter((d) => ctx.allowed(d.serial ?? d.id));
}

/** What each kind can be made from: asked once, as each list is a tool's slow answer. */
async function hubChoices(ctx: ServerContext) {
  const choices: Record<string, unknown> = {};
  for (const { virtual } of ctx.providers) {
    const made = await virtual?.catalog?.().catch(() => undefined);
    if (virtual && made) choices[virtual.kind] = made;
  }
  return choices;
}

/** The sidebar as a window was told it: said again only when it changed. */
export class HubList {
  private readonly known = new Map<string, DeviceHardware | undefined>();
  private readonly choices: Promise<Record<string, unknown>>;
  private told = '';

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

  /** A new window has been told nothing. */
  forgetTold() {
    this.told = '';
  }

  async refresh() {
    const devices = await hubDevices(this.ctx, this.hardware);
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
