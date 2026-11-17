import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { androidScreen } from '@appdyno/driver-android';
import type { Tree } from '@appdyno/protocol';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { fakeTimed } from '@appdyno/testing/fake-time.js';
import { describe, expect, it } from 'vitest';
import { connect } from './truth-client.js';

/** A simulator's read of a photo app's launch, as it answered, and of the first-run sheet that came over it 3 s later. */
const trees = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures/launch-late-sheet.json'), 'utf8'),
) as { answered: Tree; sheet: Tree };

/** A launch whose first screen holds still, then a sheet over all of it `lateMs` later, on a platform where such comes. */
class SheetAfterLaunch extends FakeDevice {
  override readonly platformScreen = { ...androidScreen, lateAfterLaunch: true };
  constructor(readonly lateMs: number) {
    super();
    this.fixture = trees.answered;
  }
  override launch(pkg: string) {
    return super.launch(pkg).then(() => {
      this.fixture = trees.answered;
      setTimeout(() => (this.fixture = trees.sheet), this.lateMs);
      this.running = true;
    });
  }
}

describe('a launch', () => {
  it(
    'that starts its app answers with a first-run sheet that comes over its screen just after it held still',
    fakeTimed(async () => {
      const device = new SheetAfterLaunch(700);
      device.running = false;
      const { call } = await connect(device);
      const r = await call('launch_app', { app: 'dev.app' });
      expect(r.text).toContain('Sürdür');
      expect(r.text).toContain('Yenilikler');
    }),
  );

  it(
    'of an app that runs is not watched for one: brought to the front, it shows what it showed',
    fakeTimed(async () => {
      const { call } = await connect(new SheetAfterLaunch(700));
      const r = await call('launch_app', { app: 'dev.app' });
      expect(r.text).not.toContain('Sürdür');
      expect(r.text).toContain('Koleksiyonlar');
    }),
  );

  it(
    'that starts its app answers once the watch is over where nothing comes, the screen it held',
    fakeTimed(async () => {
      const device = new SheetAfterLaunch(5_000);
      device.running = false;
      const { call } = await connect(device);
      const r = await call('launch_app', { app: 'dev.app' });
      expect(r.text).toContain('Koleksiyonlar');
      expect(r.text).not.toContain('Sürdür');
    }),
  );
});
