import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { type VirtualDevices, type Startable, pause } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import type { Adb } from './adb.js';

export const sdkDir = () =>
  process.env.ANDROID_HOME ??
  process.env.ANDROID_SDK_ROOT ??
  join(homedir(), 'Library/Android/sdk');

const BOOT_MS = 300_000;

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

/** The AVDs of this machine, started by the SDK's own `emulator`. */
export class AndroidEmulators implements VirtualDevices {
  constructor(private readonly adb: Adb) {}

  private run(args: string[]) {
    return new Promise<string>((resolve, reject) => {
      const p = spawn(join(sdkDir(), 'emulator/emulator'), args, {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      p.stdout.on('data', (b) => (out += b));
      p.on('error', (e) =>
        reject(
          new DeviceError('UNSUPPORTED', `the Android emulator is not installed: ${e.message}`),
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
    const up = [...running].map(([serial, avd]) => ({
      id: serial,
      name: avd,
      state: 'running' as const,
      serial,
    }));
    const idle = names
      .filter((n) => ![...running.values()].includes(n))
      .map((n) => ({ id: n, name: n, state: 'stopped' as const }));
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
        throw new DeviceError('INTERNAL', `the emulator ${id} exited at once (code ${exited})`);
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
