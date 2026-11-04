import { dirname, resolve } from 'node:path';
import { FlowError, type Flow } from './format.js';

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];

/**
 * A flow with each `run other.flow` replaced by that file's steps, so that one that cannot run is refused
 * before its first step acts, wherever the fault lies. A path is relative to the file that names it. A step
 * of another file keeps it, for a failure to say where it was written. A name means one thing in all of them,
 * as all take their values from one place, and a tag belongs to the file it is in.
 */
export function composeFlow(file: string, load: (path: string) => Flow): Flow {
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
      whole.steps.push(...inner.steps);
    }
    return whole;
  };
  return expand(file, [resolve(file)]);
}
