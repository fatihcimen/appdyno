import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { connect } from './shared.js';

/** A device that takes each event, and what it was given. */
const taking = () => {
  const got: unknown[][] = [];
  const d = Object.assign(new FakeDevice(), {
    memoryWarning: (app: string, level?: string) => {
      got.push(['memoryWarning', app, level]);
      return Promise.resolve('every app here gets it');
    },
    shake: () => {
      got.push(['shake']);
      return Promise.resolve(undefined);
    },
    addMedia: (files: string[]) => {
      got.push(['addMedia', files]);
      return Promise.resolve('the library holds 2');
    },
  });
  return { d, got };
};

describe('the one-shot events of device_setting', () => {
  it('are refused where the device takes none of them', async () => {
    const { call } = await connect(new FakeDevice());
    expect((await call('device_setting', { name: 'memory_warning' })).text).toBe(
      'UNSUPPORTED: this device takes no memory warning',
    );
    expect((await call('device_setting', { name: 'shake' })).text).toBe(
      'UNSUPPORTED: this device takes no shake',
    );
    expect((await call('device_setting', { name: 'media', value: 'a.png' })).text).toBe(
      'UNSUPPORTED: this device takes no photos or videos into its library',
    );
  });

  it('send a memory warning to the selected app, or the one named, with the level given', async () => {
    const { d, got } = taking();
    const { call } = await connect(d);
    expect((await call('device_setting', { name: 'memory_warning' })).text).toBe(
      'sent dev.app a memory warning; every app here gets it',
    );
    const named = await call('device_setting', {
      name: 'memory_warning',
      app: 'dev.other',
      value: 'RUNNING_LOW',
    });
    expect(named.done).toBe(
      'sent dev.other a memory warning (RUNNING_LOW); every app here gets it',
    );
    expect((await call('device_setting', { name: 'shake' })).text).toBe('the device was shaken');
    expect(got).toEqual([
      ['memoryWarning', 'dev.app', undefined],
      ['memoryWarning', 'dev.other', 'RUNNING_LOW'],
      ['shake'],
    ]);
  });

  it('send no memory warning to an app the server does not allow', async () => {
    const { d, got } = taking();
    const { call } = await connect(d, { policy: { apps: ['dev.app'] } });
    const r = await call('device_setting', { name: 'memory_warning', app: 'dev.other' });
    expect(r.data.code).toBe('POLICY_DENIED');
    expect(got).toEqual([]);
  });

  describe('media', () => {
    let root: string;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), 'media-'));
      vi.spyOn(process, 'cwd').mockReturnValue(join(root, 'project'));
      mkdirSync(join(root, 'project/shots'), { recursive: true });
      for (const f of ['b.png', 'a.MOV', 'notes.txt'])
        writeFileSync(join(root, 'project/shots', f), 'x');
      writeFileSync(join(root, 'secret.png'), 'x');
      symlinkSync(join(root, 'secret.png'), join(root, 'project/shots/c.png'));
    });
    afterEach(() => {
      vi.restoreAllMocks();
      rmSync(root, { recursive: true, force: true });
    });

    it("adds a folder's photos and videos inside the server's folder, and no file a link leads out to", async () => {
      const { d, got } = taking();
      const { call } = await connect(d);
      const r = await call('device_setting', { name: 'media', value: 'shots' });
      expect(r.text).toBe("added 2 files to the device's photos; the library holds 2");
      const [[, files]] = got as [[string, string[]]];
      expect(files.map((f) => f.split('/').at(-1))).toEqual(['a.MOV', 'b.png']);
    });

    it('says when a device that takes them out again does so', async () => {
      const { d } = taking();
      const addedMedia = {
        owner: undefined,
        holder: () => undefined,
        takeOut: () => Promise.resolve({ removed: [], left: [] }),
      };
      const { call } = await connect(Object.assign(d, { addedMedia }));
      expect((await call('device_setting', { name: 'media', value: 'shots' })).text).toBe(
        "added 2 files to the device's photos; the library holds 2; taken out when this session ends, or by restore",
      );
    });

    it("refuses what is outside the server's folder, missing, no photo or video, or a folder with none", async () => {
      const { d, got } = taking();
      const { call } = await connect(d);
      const out = await call('device_setting', { name: 'media', value: join(root, 'secret.png') });
      expect(out.data.code).toBe('POLICY_DENIED');
      expect(
        (await call('device_setting', { name: 'media', value: 'shots/c.png' })).data.code,
      ).toBe('POLICY_DENIED');
      expect((await call('device_setting', { name: 'media', value: 'gone.png' })).data.code).toBe(
        'NOT_FOUND',
      );
      expect(
        (await call('device_setting', { name: 'media', value: 'shots/notes.txt' })).text,
      ).toMatch(/^INVALID_ARGUMENT: .*shots\/notes\.txt is not a photo or video file$/);
      mkdirSync(join(root, 'project/empty'));
      expect((await call('device_setting', { name: 'media', value: 'empty' })).text).toMatch(
        /^INVALID_ARGUMENT: .*empty holds no photo or video inside this server's folder$/,
      );
      expect((await call('device_setting', { name: 'media' })).data.code).toBe('INVALID_ARGUMENT');
      expect(got).toEqual([]);
    });
  });
});
