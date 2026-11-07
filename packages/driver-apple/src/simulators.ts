import type { NewDevice, Startable, VirtualDevices } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Simctl } from './simctl.js';

const SIMULATOR_ID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** Kinds of simulator this Mac may have that nothing here drives. */
const NOT_DRIVEN = /Apple-(Watch|TV|Vision)/;

/** A runtime's id as people name it: iOS 27.2. */
const runtimeName = (runtime: string) =>
  runtime
    .replace(/^.*SimRuntime\./, '')
    .replace('-', ' ')
    .replaceAll('-', '.');

/** A device type's id as people name it: the same words, with spaces. */
export const typeName = (deviceType: string) =>
  deviceType.replace(/^.*SimDeviceType\./, '').replaceAll('-', ' ');

/** This Mac's simulators. */
export class Simulators implements VirtualDevices {
  readonly kind = 'simulator';
  readonly platform = 'ios';

  constructor(private readonly simctl: Simctl) {}

  async catalog() {
    const { devicetypes, runtimes } = JSON.parse(
      await this.simctl.exec(['list', 'devicetypes', 'runtimes', '-j']),
    ) as {
      devicetypes: { name: string; identifier: string; productFamily?: string }[];
      runtimes: { name: string; identifier: string; isAvailable?: boolean; platform?: string }[];
    };
    return {
      models: devicetypes
        .filter((t) => t.productFamily === 'iPhone' || t.productFamily === 'iPad')
        .map((t) => ({ id: t.identifier, name: t.name })),
      systems: runtimes
        .filter((r) => r.platform === 'iOS' && r.isAvailable !== false)
        .map((r) => ({ id: r.identifier, name: r.name })),
    };
  }

  removedBy(id: string) {
    return `xcrun simctl delete ${id}`;
  }

  async create({ name, model, system }: NewDevice) {
    const runtime = system || (await this.simctl.runtimeFor(model));
    return (await this.simctl.exec(['create', name || typeName(model), model, runtime])).trim();
  }

  async startable(): Promise<Startable[]> {
    const driven = (await this.simctl.list()).filter((d) => !NOT_DRIVEN.test(d.deviceType ?? ''));
    const names = await this.simctl.typeNames().catch(() => new Map<string, string>());
    return driven.map((d) => ({
      id: d.udid,
      name: `${d.name} (${runtimeName(d.runtime)})`,
      state: d.state === 'Booted' ? 'running' : 'stopped',
      ...(d.state === 'Booted' && { serial: d.udid }),
      ...(d.deviceType && { model: names.get(d.deviceType) ?? typeName(d.deviceType) }),
    }));
  }

  async boot(id: string) {
    if (!SIMULATOR_ID.test(id))
      throw new DeviceError('INVALID_ARGUMENT', `not a simulator id: ${id}`);
    await this.simctl.boot(id);
    return id;
  }

  shutdown(id: string) {
    return this.simctl.shutdown(id);
  }
}
