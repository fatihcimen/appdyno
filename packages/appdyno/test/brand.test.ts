import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng, must } from '@appdyno/core';

type Point = [number, number];
const root = join(import.meta.dirname, '../../..');
const art = (await import(join(root, 'scripts/icon-art.mjs'))) as {
  GENERATED: Record<string, string>;
  macIcon(px: number): string;
  luminance(color: string): number;
  DMG: { size: Point; icon: number; app: Point; applications: Point; hidden: Point };
};

describe('the icon', () => {
  it.each(Object.keys(art.GENERATED))('%s is what the source draws', (path) => {
    expect(readFileSync(join(root, path), 'utf8')).toBe(art.GENERATED[path]);
  });

  it('has a picture for each generated image, none without its source', () => {
    for (const path of [
      'ios/Branding/AppIcon60x60@2x.png',
      'ios/Branding/AppIcon60x60@3x.png',
      'mac/Viewer/tile.png',
      'docs/images/social.png',
    ])
      expect(existsSync(join(root, path))).toBe(true);
  });

  it('wears the colours of the hub', () => {
    const palette = readFileSync(join(root, 'mac/Viewer/Palette.m'), 'utf8');
    const source = readFileSync(join(root, 'scripts/icon-art.mjs'), 'utf8');
    for (const [, name, value] of source.matchAll(/^const (\w+) = '#([0-9A-F]{6})';$/gm)) {
      if (name !== 'WHITE') expect(palette).toContain(`0x${String(value)}`);
    }
  });

  it('has no closed ring at 64 px and below: that reads as a letter', () => {
    for (const px of [16, 32, 64]) expect(art.macIcon(px)).not.toContain('id="slab"');
    for (const px of [128, 256, 512, 1024]) expect(art.macIcon(px)).toContain('id="slab"');
  });

  it('keeps colours of an earlier life out of every tracked text', () => {
    const [old, older] = [['5D3E', 'BC'].join(''), ['FFD3', '00'].join('')] as const;
    const found = spawnSync('git', ['grep', '-Iil', '-e', old, '-e', older], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(found.stdout).toBe('');
  });
});

describe("the disk image's window", () => {
  const { size, icon, app, applications, hidden } = art.DMG;

  it('holds every item, the hidden two too: Finder lays one out below as room to scroll to', () => {
    // an item's box as Finder said it through Accessibility, its name under it, and the 10 points it keeps below the last
    for (const [x, y] of [app, applications, hidden]) {
      expect(x - 95).toBeGreaterThanOrEqual(0);
      expect(x + 95).toBeLessThanOrEqual(size[0]);
      expect(y - 72).toBeGreaterThanOrEqual(0);
      expect(y + 114 + 10).toBeLessThanOrEqual(size[1]);
    }
  });

  it.runIf(process.platform === 'darwin')(
    'has plates where a name reads at 4.5:1 in black and in white, as sips draws them at either scale',
    async () => {
      const icons = (await import(join(root, 'scripts/build-icons.mjs'))) as {
        buildDmgBackground(dir: string): void;
      };
      const dir = mkdtempSync(join(tmpdir(), 'appdyno-dmg-'));
      icons.buildDmgBackground(dir);
      for (const [file, scale] of [
        ['background.png', 1],
        ['background@2x.png', 2],
      ] as const) {
        const image = must(decodePng(readFileSync(join(dir, file))), file);
        for (const [x, y] of [app, applications]) {
          const at =
            (Math.round((y + icon / 2 + 13) * scale) * image.width + x * scale) * image.channels;
          const hex = [...image.data.subarray(at, at + 3)].map((v) =>
            v.toString(16).padStart(2, '0'),
          );
          const l = art.luminance(`#${hex.join('')}`);
          expect((l + 0.05) / 0.05, `black on ${file}`).toBeGreaterThanOrEqual(4.5);
          expect(1.05 / (l + 0.05), `white on ${file}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      rmSync(dir, { recursive: true, force: true });
    },
    30_000,
  );
});
