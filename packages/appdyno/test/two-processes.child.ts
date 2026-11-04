// One of the processes of two-processes.test.ts: real operations on a fake device, in a process of its own.
import { once } from 'node:events';
import type { Device, DeviceProvider, DeviceSettings, SettingName } from '@appdyno/core';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { FakeDevice } from '../../ops/test/fake-device.js';

const names = process.argv[2]!.split(',') as SettingName[];
const rounds = Number(process.argv[3]);

const WAS = 'as it was';
const values = new Map<string, string>();
const settings = {
  // the window: what reads the file before this and writes it after loses what another process wrote meanwhile
  get: async (name: SettingName) => {
    await new Promise((r) => setTimeout(r, 2));
    return values.get(name) ?? WAS;
  },
  set: async (name: SettingName, value: string) => void values.set(name, value),
} as unknown as DeviceSettings;

const device: Device = Object.assign(new FakeDevice(), { settings });
const provider: DeviceProvider = {
  list: async () => [{ serial: device.serial, state: 'device', ready: true }],
  handles: () => true,
  open: () => device,
};
const ops = opsFor(new ServerContext(DEFAULT_POLICY, [provider], { share: true }));
const setting = ops.device_setting!;
const change = () => Promise.all(names.map((name) => setting.handler({ name, value: 'changed' })));

process.stdout.write('ready\n');
await once(process.stdin, 'data');

const lost: string[] = [];
for (let round = 0; round < rounds; round++) {
  await change();
  await setting.handler({ name: 'restore' });
  // an entry the other process wrote over was never put back
  lost.push(...names.filter((name) => (values.get(name) ?? WAS) !== WAS));
  values.clear();
}
await change();
process.stdout.write(`done ${JSON.stringify(lost)}\n`);
// the last entries stay, held by a process that is still alive, until the test has read them
await once(process.stdin, 'data');
process.exit(0);
