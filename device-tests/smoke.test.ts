import { describe, expect, it } from 'vitest';
import { AndroidDevice, renderScreen } from './workspace.js';

const serial = process.env.APPDYNO_ANDROID_SERIAL;

describe.skipIf(!serial)('smoke', () => {
  it('connects, reads, taps, screenshots', async () => {
    const d = new AndroidDevice(serial!);
    let t = performance.now();
    const hello = await d.open();
    console.log(
      'open',
      Math.round(performance.now() - t),
      'ms cold',
      d.lastStartWasCold,
      JSON.stringify(hello),
    );
    await d.launch('dev.appdyno.fixture');
    for (let i = 0; i < 3; i++) {
      t = performance.now();
      const s = await d.read();
      console.log(
        'read',
        Math.round(performance.now() - t),
        'ms agent',
        s.tree.elapsedMs,
        'nodes',
        s.tree.nodes.length,
        'fg',
        s.foreground,
      );
      if (i === 0) console.log(renderScreen(s.list));
    }
    t = performance.now();
    const shot = await d.screenshot({ maxPx: 1024 });
    console.log('shot', Math.round(performance.now() - t), 'ms', JSON.stringify(shot.meta));
    d.close();
    expect(hello.platform).toBe('android');
  });
});
