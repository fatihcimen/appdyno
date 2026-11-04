import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

/** A bundle on disk: its bytes, its folders apart and the rest of its files together. */
export async function bundleSize(
  app: string,
): Promise<{ bytes: number; parts: Record<string, number> }> {
  const parts: Record<string, number> = {};
  let bytes = 0;
  for (const e of await readdir(app, { recursive: true, withFileTypes: true })) {
    if (e.isDirectory()) continue;
    const path = join(e.parentPath, e.name);
    const { size } = await lstat(path);
    const [top, ...rest] = relative(app, path).split(sep);
    const part = rest.length ? top! : 'files';
    parts[part] = (parts[part] ?? 0) + size;
    bytes += size;
  }
  return { bytes, parts };
}
