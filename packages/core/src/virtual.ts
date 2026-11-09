import type { Platform } from '@appdyno/protocol';

/** A simulator or emulator that can be started, whatever its state. */
export type Startable = {
  id: string;
  name: string;
  state: 'running' | 'stopped';
  serial?: string;
  /** The hardware it stands for, as people name it. */
  model?: string;
  /** Once stopped, this Mac's tools could not start it again: an emulator of another SDK or AVD folder. */
  bootable?: false;
};

/** What a new virtual device is made from, by the ids a driver's own tools take. */
export type VirtualCatalog = {
  models: { id: string; name: string }[];
  systems: { id: string; name: string }[];
};

export type NewDevice = { name: string; model: string; system: string };

/** Starting and stopping the virtual devices of a driver. */
export type VirtualDevices = {
  readonly kind: 'simulator' | 'emulator';
  readonly platform: Platform;
  startable(): Promise<Startable[]>;
  /** Starts it and answers its serial once it can be driven; `serial`: the one it ran as, taken again where it is free. */
  boot(id: string, serial?: string): Promise<string>;
  shutdown(id: string): Promise<void>;
  /** What can be made; none where the tools that make one are missing. */
  catalog?(): Promise<VirtualCatalog | undefined>;
  /** Makes one and answers its id; with no `system` on the newest that runs the model, where a driver can tell. */
  create?(device: NewDevice): Promise<string>;
  /** What a person runs to remove one that was made: there is no tool for it here. */
  removedBy?(id: string): string;
};
