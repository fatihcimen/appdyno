import { expect, it } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './driving/shared.js';

it('keeps the lines that hold contains, whatever its case, and matches no secret it hid', async () => {
  const device = new FakeDevice();
  device.logLines = [
    'I app: Order 43 placed',
    'I UIKit: event dispatched',
    'I app: order 44 placed',
    'I app: token=order-secret-1',
  ];
  const { call } = await connect(device);
  expect((await call('logs', { contains: 'ORDER' })).text.split('\n')).toEqual([
    expect.stringMatching(/^2 lines with "ORDER" of dev\.app from /),
    'I app: Order 43 placed',
    'I app: order 44 placed',
  ]);
  expect((await call('logs', { contains: 'secret' })).text).toMatch(/^0 lines with/);
});
