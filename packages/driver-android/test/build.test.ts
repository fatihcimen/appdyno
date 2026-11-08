import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { builtApk, buildVariant } from '../src/build.js';

describe('a Gradle build', () => {
  let outputs: string;
  beforeEach(() => {
    outputs = mkdtempSync(join(tmpdir(), 'build-test-'));
  });
  afterEach(() => rmSync(outputs, { recursive: true, force: true }));

  const record = (folder: string, variantName: string) => {
    mkdirSync(join(outputs, folder), { recursive: true });
    writeFileSync(
      join(outputs, folder, 'output-metadata.json'),
      JSON.stringify({
        variantName,
        applicationId: `dev.app.${variantName}`,
        elements: [{ outputFile: `${variantName}.apk` }],
      }),
    );
  };

  it('finds a variant by its record, a flavor among others', () => {
    record('debug', 'debug');
    record(join('free', 'debug'), 'freeDebug');
    expect(builtApk(outputs, 'freedebug')).toEqual({
      path: join(outputs, 'free', 'debug', 'freeDebug.apk'),
      id: 'dev.app.freeDebug',
    });
  });

  it('says when a build left nothing', () => {
    expect(() => builtApk(join(outputs, 'gone'), 'debug')).toThrow(/no APK for debug/);
  });

  it('refuses a folder with no wrapper, so nothing it holds runs', async () => {
    await expect(buildVariant({ project: outputs })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });
});
