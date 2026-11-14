import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { apkId, apkNames } from '../src/apk-names.js';

// names.apk and plain.apk are aapt2's own output: a label by resource in two languages, and a plain one
const fixture = (name: string) => join(import.meta.dirname, 'fixtures/install', name);

describe('apk names', () => {
  it('reads the package and the label in every language the file has', async () => {
    expect(await apkNames(fixture('names.apk'))).toEqual({
      id: 'dev.appdyno.names',
      names: ['Names app', 'İsimler uygulaması', 'dev.appdyno.names'],
    });
  });

  it('reads a label written in the manifest', async () => {
    expect(await apkNames(fixture('plain.apk'))).toEqual({
      id: 'dev.appdyno.fixture',
      names: ['appdyno fixture', 'dev.appdyno.fixture'],
    });
  });

  it('reads the package alone from the manifest, as an install names it', async () => {
    expect(await apkId(fixture('names.apk'))).toBe('dev.appdyno.names');
  });

  it('fails on a file that is no app', async () => {
    await expect(apkNames(import.meta.filename)).rejects.toThrow();
  });
});
