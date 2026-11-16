import { writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { must } from '@appdyno/core';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { clientOf, recorded, simulator, type Call } from './kit.js';
import { logLines, TASKS } from './tasks.js';

const sum = (calls: Call[], of: 'text' | 'structured') => calls.reduce((n, c) => n + c[of], 0);

/** One answer's size, as `text / structured`. */
async function answer(
  device: FakeDevice,
  tool: string,
  args: Record<string, unknown> = {},
  before: string[] = [],
) {
  const { call, calls } = await clientOf(device, device.current().windows[0]?.pkg);
  for (const first of before) await call(first);
  await call(tool, args);
  const c = must(calls.at(-1), 'its answer');
  return `${String(c.text)} / ${String(c.structured)}`;
}

/**
 * What an agent pays for a task, with no device: the calls it takes and the characters of their answers, on the
 * recorded screens. `scripts/efficiency.mjs` prints it; here the calls are held, so that a change that costs a task
 * one more is seen.
 */
it('keeps each task within its calls', { timeout: 120_000 }, async () => {
  const rows: string[] = [
    '| task | calls | refused | text | structured |',
    '| --- | --- | --- | --- | --- |',
  ];
  // a task that did not get done counts no calls: fewer calls for a wrong answer is no gain
  const taken: Record<string, number> = {};
  const answers: string[] = [];
  for (const task of TASKS) {
    const { calls, proof } = await task.run();
    taken[task.name] = proof ? calls.length : 0;
    answers.push(...calls.map((c) => `## ${task.name}: ${c.tool}\n\n${c.said}\n`));
    rows.push(
      `| ${task.name}: ${calls.map((c) => c.tool).join(', ')} | ${calls.length} | ${calls.filter((c) => c.refused).length} | ${sum(calls, 'text')} | ${sum(calls, 'structured')} |`,
    );
  }
  const { client } = await clientOf(new FakeDevice());
  const list = () =>
    simulator(recorded('driver-apple/test/fixtures/ios-screens/list-under-status-bar.json'));
  const over = () => simulator(recorded('ops/test/fixtures/power/ios-control-center-app.json'));
  const logs = Object.assign(new FakeDevice(), { logLines: logLines(200) });
  const sizes = [
    `catalog: ${JSON.stringify(await client.listTools()).length}`,
    `instructions: ${String(client.getInstructions()?.length)}`,
    `screen, a list of 49 elements: ${await answer(list(), 'screen')}`,
    `tap by a stale ref, the list: ${await answer(list(), 'tap', { ref: '@gone' }, ['screen'])}`,
    `steps refused, 70 elements: ${await answer(over(), 'run_steps', { steps: [{ tool: 'tap', selector: { text: 'Nowhere' } }] }, ['screen'])}`,
    `logs, 200 lines: ${await answer(logs, 'read_logs')}`,
  ];
  const out = process.env.APPDYNO_EFFICIENCY_OUT;
  if (out) writeFileSync(out, [...rows, '', ...sizes, ''].join('\n'));
  if (out) writeFileSync(`${out}.answers`, answers.join('\n'));
  expect(taken).toEqual({
    'log in': 2,
    'log in, a slow result': 2,
    'three items in the basket': 2,
    'find a setting, change it': 3,
    'a crash and its log': 2,
    'record a flow, replay it': 5,
    'a stale ref, then the row': 3,
    'a selector with no match, then the row': 3,
  });
});
