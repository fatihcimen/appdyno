import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { type BuildRequest, run, runBuild, stateDir } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

const SETTINGS_BYTES = 64 * 1024 * 1024;
const WORDS = {
  step: /^(Compile\w*|Ld|CodeSign|PhaseScriptExecution|ProcessInfoPlistFile)\b/,
  error: /\berror:|^xcodebuild: error/,
};

type Settings = { buildSettings: Record<string, string | undefined> };

/** The app in what a scheme builds: the test bundles and frameworks beside it are not what runs. */
export function builtApp(settings: Settings[]) {
  const app = settings
    .map((s) => s.buildSettings)
    .find((s) => s.WRAPPER_EXTENSION === 'app' && s.TARGET_BUILD_DIR && s.WRAPPER_NAME);
  if (!app?.PRODUCT_BUNDLE_IDENTIFIER)
    throw new DeviceError('INVALID_ARGUMENT', 'the scheme builds no app');
  return {
    path: join(app.TARGET_BUILD_DIR!, app.WRAPPER_NAME!),
    bundle: app.PRODUCT_BUNDLE_IDENTIFIER,
  };
}

/**
 * Builds a scheme for one device, by the project's own signing, in a folder of ours per project.
 * shortcut: no -allowProvisioningUpdates, which changes a person's Apple account; a phone with no profile yet is told so
 * by xcodebuild, until someone asks for that to be an option.
 */
export async function buildScheme(req: BuildRequest, destination: string) {
  const project = resolve(req.project);
  const kind = project.endsWith('.xcworkspace')
    ? '-workspace'
    : project.endsWith('.xcodeproj')
      ? '-project'
      : undefined;
  if (!kind || !existsSync(project))
    throw new DeviceError('INVALID_ARGUMENT', `not an Xcode project: ${project}`);
  if (!req.scheme) throw new DeviceError('INVALID_ARGUMENT', 'an Xcode project needs scheme');
  const folder = createHash('sha256').update(project).digest('hex').slice(0, 16);
  const args = [
    kind,
    project,
    '-scheme',
    req.scheme,
    '-configuration',
    req.configuration ?? 'Debug',
    '-destination',
    destination,
    '-derivedDataPath',
    join(stateDir(), 'builds', folder),
  ];
  await runBuild('xcodebuild', [...args, 'build'], WORDS);
  const { stdout } = await run('xcodebuild', [...args, '-showBuildSettings', '-json'], {
    maxBuffer: SETTINGS_BYTES,
  });
  return builtApp(JSON.parse(stdout) as Settings[]);
}
