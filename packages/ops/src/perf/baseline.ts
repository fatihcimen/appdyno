import type { BaselineReading } from '@appdyno/core';
import { pairedChange } from '@appdyno/perf';

/** What the device says, in words: `reason=install-dm` alone would read as applied when a `.dm` compiled nothing. */
const onDevice = ({ state, applied }: BaselineReading) => {
  if (applied) return `on the device: ${state}: applied`;
  if (state?.includes('install-dm'))
    return `on the device: ${state}: delivered, and it compiled nothing: a .dm of another Android's format does this`;
  return `on the device: ${state ?? 'no state read'}: not applied`;
};

/** What a profile's cold starts say, as the gate would call it: only a change that counts is worth anything. */
export function baselineVerdict({ without, with: withProfile }: BaselineReading) {
  const change = pairedChange(without, withProfile, 'ms');
  const faster = -Math.round(change.moved);
  const p = change.p < 0.0001 ? '< 0.0001' : change.p.toFixed(4);
  const said = `cold start ${Math.round(change.before)} ms without, ${Math.round(change.after)} ms with: ${faster} ms faster (${Math.round((faster / change.before) * 100)} %), p ${p}`;
  if (!change.called)
    return {
      verdict: 'no-gain' as const,
      line: `${said}, inside ${Math.round(change.floor)} ms or the rank test: no gain to call`,
    };
  return faster > 0
    ? { verdict: 'worth-it' as const, line: `${said}: worth it` }
    : { verdict: 'slower' as const, line: `${said}: slower with it` };
}

export const baselineLines = (b: BaselineReading) => [
  b.present
    ? 'Baseline Profile: in the APK'
    : 'Baseline Profile: none in the APK: assets/dexopt/baseline.prof is what a build leaves',
  onDevice(b),
  ...(b.rules ? [`${b.rules} rules once installed`] : []),
  ...(b.without.length > 0 ? [baselineVerdict(b).line] : []),
];
