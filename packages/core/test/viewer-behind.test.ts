import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ViewerProcess } from '../src/index.js';
import { compiled, run, WAIT_MS } from './viewer-helpers.js';

const built = compiled();

describe('the viewer, compiled by its first-use path', () => {
  it('kept behind, it is one the system can never put in front, whoever started it', async () => {
    const viewer = spawn(built.binary, ['--hub', '--behind'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    try {
      let kind: string | undefined;
      for (let i = 0; i < 100 && !kind; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const { stdout } = await run('lsappinfo', [
          'info',
          '-only',
          'ApplicationType',
          String(viewer.pid),
        ]);
        // up to macOS 26 the field alone, "ApplicationType"="…"; from 27 the whole record, with type="…"
        kind = /(?:"ApplicationType"|\btype)="(\w+)"/.exec(stdout)?.[1];
      }
      expect(kind).toBe('BackgroundOnly');
    } finally {
      viewer.kill();
    }
  }, 30_000);

  it.each(['--headless', '--behind'])(
    '%s copies to a board of its own',
    async (flag) => {
      const file = join(built.dir, `copied${flag}.png`);
      // a picture of one pixel
      const pixel =
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
      writeFileSync(file, Buffer.from(pixel, 'base64'));
      const v = new ViewerProcess(built.binary, [flag]);
      const board = `$.NSPasteboard.pasteboardWithName('dev.appdyno.behind.${v.pid}')`;
      const ask = async (what: string) => {
        const read = `ObjC.import('AppKit'); ${what}`;
        return (await run('osascript', ['-l', 'JavaScript', '-e', read])).stdout.trim();
      };
      // only its own: the general board's count is the whole Mac's, and anything else copying moves it
      const count = async () => Number(await ask(`${board}.changeCount`));
      const held = () => ask(`ObjC.unwrap(${board}.stringForType($.NSPasteboardTypeString)) || ''`);
      try {
        const before = await count();
        v.send({ op: 'copied', file });
        v.send({ op: 'copyText', text: 'nothing of a person' });
        const end = Date.now() + WAIT_MS;
        let after = await count();
        while (after < before + 2 && Date.now() < end) after = await count();
        expect(after).toBeGreaterThanOrEqual(before + 2);
        expect(await held()).toBe('nothing of a person');
        const gone = new Promise((resolve) => v.onExit(resolve));
        v.send({ op: 'quit' });
        await gone;
        expect(await held()).toBe('');
      } finally {
        v.kill();
      }
    },
    WAIT_MS + 10_000,
  );
});
