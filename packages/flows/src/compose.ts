import { dirname, resolve } from 'node:path';
import { FlowError, type Flow, type FlowStep } from './format.js';

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/** A folder's shared files: every flow in the folder, and in the folders under it, begins and ends with them. */
export const SETUP_FILE = '_setup.flow';
export const TEARDOWN_FILE = '_teardown.flow';

/** The folders' shared files that hold for one flow, each list in the order it runs. */
export type SharedFiles = { setup: string[]; teardown: string[] };

/**
 * A flow with each `run other.flow` replaced by that file's steps, so that one that cannot run is refused
 * before its first step acts, wherever the fault lies. A path is relative to the file that names it. A step
 * of another file keeps it, for a failure to say where it was written. A name means one thing in all of them,
 * as all take their values from one place, and a tag belongs to the file it is in.
 *
 * Its setup is the folders' shared ones, outermost first, then the file its own `setup` line names; its teardown
 * the file its `teardown` line names, then the folders', innermost first. Only the file a run starts from has them:
 * a file another one runs brings its steps alone.
 */
export function composeFlow(
  file: string,
  load: (path: string) => Flow,
  shared: SharedFiles = { setup: [], teardown: [] },
): Flow {
  /** What a file read in gives the one that reads it, but its steps: a file for another app is refused. */
  const take = (whole: Flow, inner: Flow, target: string, where: string) => {
    if (inner.app) {
      if (whole.app && inner.app !== whole.app)
        throw new FlowError(
          `${where}: ${target} is for ${inner.app}, this flow for ${whole.app}`,
          0,
        );
      whole.app = inner.app;
    }
    whole.params = union(whole.params, inner.params);
    whole.secrets = union(whole.secrets, inner.secrets);
  };
  const expand = (path: string, chain: string[]): Flow => {
    const flow = load(path);
    const whole: Flow = { ...flow, steps: [] };
    for (const st of flow.steps) {
      if (st.action !== 'run') {
        whole.steps.push(chain.length > 1 ? { ...st, file: path } : st);
        continue;
      }
      const where = `${path}:${st.line}`;
      const target = resolve(dirname(path), String(st.args.file));
      if (chain.includes(target))
        throw new FlowError(
          `${where}: a flow cannot run itself: ${[...chain, target].join(' runs ')}`,
          0,
        );
      const inner = expand(target, [...chain, target]);
      take(whole, inner, target, where);
      whole.steps.push(...inner.steps);
    }
    return whole;
  };
  const top = resolve(file);
  const whole = expand(file, [top]);
  const phase = (paths: string[]): FlowStep[] =>
    paths.flatMap((path) => {
      // its own steps too are another file's here, and it cannot run the flow it is the start or the end of
      const inner = expand(path, [top, resolve(path)]);
      take(whole, inner, path, file);
      return inner.steps;
    });
  const named = (name: string | undefined) => (name ? [resolve(dirname(file), name)] : []);
  const setup = phase([...shared.setup, ...named(whole.setupFile)]);
  const teardown = phase([...named(whole.teardownFile), ...shared.teardown]);
  return {
    ...whole,
    ...(setup.length > 0 && { setup }),
    ...(teardown.length > 0 && { teardown }),
  };
}
