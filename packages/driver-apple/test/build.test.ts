import { describe, expect, it } from 'vitest';
import { buildScheme, builtApp } from '../src/build.js';

describe('an Xcode build', () => {
  it('picks the app among what a scheme builds', () => {
    const app = {
      WRAPPER_EXTENSION: 'app',
      TARGET_BUILD_DIR: '/d',
      WRAPPER_NAME: 'My.app',
      PRODUCT_BUNDLE_IDENTIFIER: 'dev.my',
    };
    const tests = { WRAPPER_EXTENSION: 'xctest', TARGET_BUILD_DIR: '/d', WRAPPER_NAME: 'T.xctest' };
    expect(builtApp([{ buildSettings: tests }, { buildSettings: app }])).toEqual({
      path: '/d/My.app',
      bundle: 'dev.my',
    });
    expect(() => builtApp([{ buildSettings: tests }])).toThrowError(/builds no app/);
  });

  it('refuses what is not a project, and a project with no scheme', async () => {
    await expect(buildScheme({ project: '/tmp/a.txt' }, 'id=x')).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(
      buildScheme({ project: import.meta.dirname + '/../no.xcodeproj', scheme: 'A' }, 'id=x'),
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });
});
