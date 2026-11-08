import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { type BuildRequest, must, runBuild } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';

const WORDS = {
  step: /^> Task \S+/,
  error: /^e: |\berror:|^Execution failed|^> (?!Task )/,
};

type Outputs = {
  variantName?: string;
  applicationId?: string;
  elements?: { outputFile: string }[];
};

/** The file and id a variant came to, as the build's own record has them: a flavor's folder is deeper. */
export function builtApk(outputs: string, variant: string) {
  const records = existsSync(outputs) ? readdirSync(outputs, { recursive: true }) : [];
  for (const name of records.map(String).filter((f) => f.endsWith('output-metadata.json'))) {
    const record = JSON.parse(readFileSync(join(outputs, name), 'utf8')) as Outputs;
    const file = record.elements?.[0]?.outputFile;
    if (record.variantName?.toLowerCase() === variant.toLowerCase() && file && record.applicationId)
      return { path: join(outputs, dirname(name), file), id: record.applicationId };
  }
  throw new DeviceError('NOT_FOUND', `the build left no APK for ${variant} in ${outputs}`);
}

/** `scheme` is the module, and `configuration` the variant. */
export async function buildVariant(req: BuildRequest) {
  const project = resolve(req.project);
  if (!existsSync(join(project, 'gradlew')))
    throw new DeviceError('INVALID_ARGUMENT', `no gradlew in ${project}`);
  const module = req.scheme ?? 'app';
  const variant = req.configuration ?? 'debug';
  const task = `:${module}:assemble${must(variant[0], 'a variant').toUpperCase()}${variant.slice(1)}`;
  await runBuild('./gradlew', [task], WORDS, project);
  return builtApk(join(project, module, 'build', 'outputs', 'apk'), variant);
}
