import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type NewDevice, type VirtualDevices, type Startable, pause, run } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Adb } from './adb.js';

export const sdkDir = () =>
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');

const BOOT_MS = 300_000;

const AVD_NAME = /^[\w.-]+$/;
const avdmanager = () => join(sdkDir(), 'cmdline-tools/latest/bin/avdmanager');
/** Of the many profiles `avdmanager` has, what a person making a phone or a tablet would pick. */
const PROFILE = /^(pixel_|medium_|small_phone)/;
const profileName = (id: string) =>
  id.replace(/_/g, ' ').replace(/\b([a-z])/g, (c) => c.toUpperCase());

/** Where the search for a free console port starts: a Mac shared with other work may keep some. */
const firstPort = () => Number(process.env.APPDYNO_EMULATOR_FIRST_PORT ?? 5554);

const LAST_PORT = 5680;

/** A port nothing here listens on now; the emulator takes it a moment later. */
const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });

/**
 * The emulator's own gRPC port, not ours, behind a token it writes to a file only this user reads: a window's
 * picture comes by it, with nothing in the guest. Whoever names `-grpc` has their own way.
 */
export const grpcArgs = (extra: string[], port: number) =>
  extra.includes('-grpc') ? [] : ['-grpc', String(port), '-grpc-use-token'];

/** The hardware profile an AVD was made from, as people name it. */
function avdModel(avd: string) {
  try {
    const config = readFileSync(join(homedir(), '.android/avd', `${avd}.avd/config.ini`), 'utf8');
    const profile = /^hw\.device\.name\s*=\s*(.+)$/m.exec(config)?.[1]?.trim();
    return profile && profileName(profile);
  } catch {
    return undefined;
  }
}

/** The AVDs of this machine, started by the SDK's own `emulator`. */
export class AndroidEmulators implements VirtualDevices {
  readonly kind = 'emulator';
  readonly platform = 'android';

  constructor(private readonly adb: Adb) {}

  async catalog() {
    const root = join(sdkDir(), 'system-images');
    if (!existsSync(avdmanager()) || !existsSync(root)) return undefined;
    const under = (...path: string[]) =>
      readdirSync(join(root, ...path)).filter((f) => !f.startsWith('.'));
    const systems = under().flatMap((api) =>
      under(api).flatMap((tag) =>
        under(api, tag).map((abi) => ({
          id: `system-images;${api};${tag};${abi}`,
          name: `${api.replace('android-', 'API ')}, ${tag.replaceAll('_', ' ')}`,
        })),
      ),
    );
    const { stdout } = await run(avdmanager(), ['list', 'device', '-c'], { timeout: 60_000 });
    const models = stdout
      .split(/\r?\n/)
      .filter((id) => PROFILE.test(id))
      .map((id) => ({ id, name: profileName(id) }));
    return { models, systems };
  }

  /** `avdmanager` asks whether a custom hardware profile is wanted, and is told no. */
  async create({ name, model, system }: NewDevice) {
    const avd = name || `appdyno_${model}`;
    if (!AVD_NAME.test(avd))
      throw new DeviceError('INVALID_ARGUMENT', `an emulator's name has no spaces: ${avd}`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(avdmanager(), ['create', 'avd', '-n', avd, '-k', system, '-d', model], {
        stdio: ['pipe', 'ignore', 'pipe'],
      });
      let said = '';
      p.stderr.on('data', (b: Buffer) => (said += b.toString()));
      p.on('error', reject);
      p.on('close', (code) =>
        code === 0 ? resolve() : reject(new DeviceError('UNSUPPORTED', said.trim().slice(-200))),
      );
      p.stdin.end('no\n');
    });
    return avd;
  }

  private run(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const p = spawn(join(sdkDir(), 'emulator/emulator'), args, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      p.stdout.on('data', (b: Buffer) => (out += b.toString()));
      p.on('error', (e) =>
        reject(
          new DeviceError(
            'UNSUPPORTED',
            `the Android emulator is not installed: ${e.message}`,
            "Android Studio's SDK Manager installs it, under SDK Tools",
          ),
        ),
      );
      p.on('close', () => resolve(out));
    });
  }

  private async running() {
    const avds = new Map<string, string>();
    for (const d of await this.adb.devices()) {
      if (!d.serial.startsWith('emulator-')) continue;
      const name = await this.adb
        .run(['-s', d.serial, 'emu', 'avd', 'name'], 10_000)
        .catch(() => '');
      const avd = name.split(/\r?\n/)[0]?.trim();
      if (avd) avds.set(d.serial, avd);
    }
    return avds;
  }

  async startable(): Promise<Startable[]> {
    const names = (await this.run(['-list-avds']))
      .split(/\r?\n/)
      .filter((l) => /^[\w.-]+$/.test(l));
    const running = await this.running();
    const withModel = (avd: string) => {
      const model = avdModel(avd);
      return { name: avd, ...(model && { model }) };
    };
    const up = [...running].map(([serial, avd]) => ({
      id: serial,
      ...withModel(avd),
      state: 'running' as const,
      serial,
    }));
    const idle = names
      .filter((n) => ![...running.values()].includes(n))
      .map((n) => ({ id: n, ...withModel(n), state: 'stopped' as const }));
    return [...up, ...idle];
  }

  async boot(id: string): Promise<string> {
    if (id.startsWith('emulator-')) return id;
    const taken = new Set((await this.adb.devices()).map((d) => d.serial));
    let port = firstPort();
    while (taken.has(`emulator-${port}`) && port < LAST_PORT) port += 2;
    const serial = `emulator-${port}`;
    // APPDYNO_EMULATOR_ARGS: for instance -no-window on a machine with no screen to spare
    const extra = process.env.APPDYNO_EMULATOR_ARGS?.split(/\s+/).filter(Boolean) ?? [
      '-no-snapshot-save',
      '-no-boot-anim',
    ];
    const grpc = grpcArgs(extra, extra.includes('-grpc') ? 0 : await freePort());
    const child = spawn(
      join(sdkDir(), 'emulator/emulator'),
      ['-avd', id, '-port', String(port), ...extra, ...grpc],
      {
        detached: true,
        stdio: 'ignore',
      },
    );
    let exited: number | null | undefined;
    child.on('exit', (code) => (exited = code));
    child.on('error', () => (exited = -1));
    child.unref();
    const end = Date.now() + BOOT_MS;
    while (Date.now() < end) {
      if (exited !== undefined)
        throw new DeviceError(
          'INTERNAL',
          `the emulator ${id} exited at once (code ${String(exited)})`,
        );
      const on = (await this.adb.devices()).find((d) => d.serial === serial);
      if (on?.state === 'device') {
        const done = await this.adb.exec(serial, 'getprop sys.boot_completed').catch(() => '');
        if (done.trim() === '1') return serial;
      }
      await pause(1_000);
    }
    throw new DeviceError('TIMEOUT', `the emulator ${id} did not finish booting in ${BOOT_MS} ms`);
  }

  async shutdown(id: string) {
    if (!id.startsWith('emulator-')) return;
    await this.adb.run(['-s', id, 'emu', 'kill'], 30_000);
    const end = Date.now() + 60_000;
    while (Date.now() < end) {
      if (!(await this.adb.devices()).some((d) => d.serial === id)) return;
      await pause(500);
    }
    throw new DeviceError('TIMEOUT', `${id} did not shut down`);
  }
}
