import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-reads-')));
});

describe('set_device with no value', () => {
  it('reads the orientation by the quarter turns the device says, and by the shape where it says none', async () => {
    class Turned extends FakeDevice {
      rotation: number | undefined = 1;
      screenNow() {
        const { rotation } = this;
        return Promise.resolve(
          rotation === undefined ? undefined : { w: 2400, h: 1080, density: 420, rotation },
        );
      }
    }
    const d = new Turned();
    const { call } = await connect(d);
    const turned = await call('set_device', { name: 'orientation' });
    expect(turned.error).toBe(false);
    expect(turned.text).toBe('orientation: landscape_left');
    expect(d.calls.filter((c) => c.name === 'setOrientation')).toEqual([]);
    d.rotation = undefined;
    expect((await call('set_device', { name: 'orientation' })).text).toBe(
      'orientation: portrait or upside_down: the screen is tall, and this device does not say which way',
    );
  });

  it('reads the location this tool fixed, and says it fixed none where it did not', async () => {
    const d = new FakeDevice();
    const { call } = await connect(d);
    expect((await call('set_device', { name: 'location' })).text).toBe(
      'location: the real one: none is fixed here, and a device does not tell where it is',
    );
    await call('set_device', { name: 'location', value: '41.01,28.98' });
    expect((await call('set_device', { name: 'location' })).text).toBe(
      'location: 41.010000, 28.980000; none puts back the real one',
    );
    await call('set_device', { name: 'location', value: 'none' });
    expect((await call('set_device', { name: 'location' })).text).toMatch(
      /^location: the real one/,
    );
    expect(d.calls.filter((c) => c.name === 'setLocation')).toHaveLength(1);
  });
});
