import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');
const art = (await import(join(root, 'scripts/icon-art.mjs'))) as {
  GENERATED: Record<string, string>;
  macIcon(px: number): string;
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
      if (name !== 'WHITE') expect(palette).toContain(`0x${value}`);
    }
  });

  it('has no closed ring at 64 px and below: that reads as a letter', () => {
    for (const px of [16, 32, 64]) expect(art.macIcon(px)).not.toContain('id="slab"');
    for (const px of [128, 256, 512, 1024]) expect(art.macIcon(px)).toContain('id="slab"');
  });

  it('keeps colours of an earlier life out of every tracked text', () => {
    const gone = [['5D3E', 'BC'].join(''), ['FFD3', '00'].join('')];
    const found = spawnSync('git', ['grep', '-Iil', '-e', gone[0]!, '-e', gone[1]!], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(found.stdout).toBe('');
  });
});
