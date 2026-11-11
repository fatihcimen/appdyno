import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '../../..');

describe('a script', () => {
  it('is type-checked with the rest, as nothing else runs it', () => {
    const scripts: unknown = JSON.parse(readFileSync(join(root, 'tsconfig.json'), 'utf8'));
    expect(scripts).toHaveProperty('compilerOptions.checkJs', true);
    expect(scripts).toHaveProperty('include', ['**/*.mjs', '*.js', '*.ts']);
    const { typecheck } = (
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(typecheck).toContain('tsc -p tsconfig.json');
  });
});
