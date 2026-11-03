import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId } from '../store.js';
import { loadDashboard } from './load.js';
import { renderDashboard } from './render.js';

export { loadDashboard, SHOWN_RUNS, type DashboardData, type KeyRuns } from './load.js';
export { formatValue } from './format.js';
export { renderDashboard } from './render.js';

/** Writes the page; a page open on it reloads by itself and must never find half a file. */
export async function writeDashboard(
  dir: string,
  projectDir: string,
  to: { app?: string; out?: string } = {},
): Promise<string> {
  const folder = to.out ?? join(dir, 'dashboard');
  const html = renderDashboard(await loadDashboard(dir, projectDir, to));
  await mkdir(folder, { recursive: true });
  const file = join(folder, 'index.html');
  const partial = join(folder, `${newId('partial')}.tmp`);
  await writeFile(partial, html);
  await rename(partial, file);
  return file;
}
