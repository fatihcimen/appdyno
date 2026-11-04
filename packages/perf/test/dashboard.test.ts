import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addToBaseline,
  loadDashboard,
  recordsOf,
  renderDashboard,
  saveBaseline,
  saveRefusal,
  saveRun,
  writeDashboard,
  type DeviceInfo,
  type Metric,
  type PerfRecord,
} from '../src/index.js';

const PHONE: DeviceInfo = {
  serial: 'p',
  platform: 'android',
  model: 'Pixel 9',
  os: '15',
  virtual: false,
};
const PHONE_CLASS = 'android-physical-Pixel_9-15';
const EMULATOR: DeviceInfo = {
  serial: 'e',
  platform: 'android',
  model: 'sdk_gphone64',
  os: '14',
  virtual: true,
};
const NOW = Date.now();
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const launch = (ms: number): Metric => ({
  kind: 'launch.ttid_ms',
  unit: 'ms',
  samples: [0, 1, 2, 3, 4, 5].map((i) => ms + i),
});

type RunOptions = {
  app?: string;
  scenario?: string;
  device?: DeviceInfo;
  host?: number;
  build?: PerfRecord['build'];
};

const records = (at: string, metrics: Metric[], o: RunOptions = {}) =>
  recordsOf(
    {
      run: `run-${at}`,
      app: o.app ?? 'dev.app',
      scenario: o.scenario ?? 'launch-cold',
      source: 'test',
      raw: '',
      device: o.device ?? PHONE,
      build: o.build ?? 'release',
      load: { host: [o.host ?? 1], hostCpus: 8 },
      tool: 'test',
      at,
    },
    metrics,
  );

/** A store on disk and the page it gives. */
function store() {
  const dir = mkdtempSync(join(tmpdir(), 'dashboard-'));
  const project = mkdtempSync(join(tmpdir(), 'dashboard-project-'));
  return {
    dir,
    project,
    run: (minutes: number, metrics: Metric[], o?: RunOptions) =>
      saveRun(dir, records(ago(minutes), metrics, o)),
    page: async (filter: { app?: string } = {}) =>
      renderDashboard(await loadDashboard(dir, project, filter)),
  };
}

/** A baseline of three launches around 400 ms and a budget of 600. */
async function baselineAndBudget(project: string) {
  let baseline;
  for (const [i, ms] of [400, 402, 398].entries()) {
    const key = { app: 'dev.app', scenario: 'launch-cold', deviceClass: PHONE_CLASS };
    baseline = addToBaseline(key, baseline, records(ago(100 - i), [launch(ms)]));
  }
  await saveBaseline(project, baseline!);
  writeFileSync(
    join(project, 'budgets.json'),
    JSON.stringify([{ kind: 'launch.ttid_ms', max: 600 }]),
  );
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the page', () => {
  it('has no script, loads nothing and allows only itself', async () => {
    const s = store();
    await s.run(5, [launch(400)]);
    await s.run(1, [launch(410)]);
    const html = await s.page();
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain(`content="default-src 'none'; style-src 'unsafe-inline'"`);
    expect(html).toContain('http-equiv="refresh"');
    expect(html).not.toMatch(/https?:|\bsrc=|url\(/);
    expect(html.match(/href="[^"]*"/g)?.every((h) => h.startsWith('href="#'))).toBe(true);
  });

  it('escapes what the store holds', async () => {
    const hostile = '<img src=x onerror=alert(1)>';
    const s = store();
    await s.run(5, [{ ...launch(400), kind: `journey.${hostile}` }], { app: hostile });
    await s.run(1, [{ ...launch(410), kind: `journey.${hostile}` }], { app: hostile });
    await saveRefusal(s.dir, {
      deviceClass: PHONE_CLASS,
      measure: 'energy',
      reason: `no </td><script>alert(2)</script> ${hostile}`,
      at: ago(0),
    });
    const html = await s.page();
    expect(html).not.toMatch(/<script|<img/i);
    expect(textOf(html)).toContain('alert(2)');
    expect(html).toContain('&#60;img src=x onerror=alert(1)&#62;');
  });

  it('escapes an app name no folder could hold', () => {
    const app = '"><script>alert(1)</script>';
    const [record] = records(ago(1), [launch(400)], { app });
    const key = { app, scenario: 'launch-cold', deviceClass: PHONE_CLASS };
    const html = renderDashboard({
      now: ago(0),
      keys: [{ key, runs: [[record!]], total: 1 }],
      rules: [],
      refusals: [],
      unread: [],
    });
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('&#60;script&#62;');
  });

  it('on an empty store shows the one command that fills it', async () => {
    const html = await store().page();
    expect(textOf(html)).toContain('appdyno perf survey --app');
    expect(html).not.toContain('<table');
    const named = await store().page({ app: 'dev.nothing' });
    expect(textOf(named)).toContain('appdyno perf survey --app dev.nothing');
  });

  it('says so when nothing needs attention, and what that rests on', async () => {
    const s = store();
    await s.run(1, [launch(400)]);
    const text = textOf(await s.page());
    expect(text).toContain('Nothing needs attention');
    expect(text).toContain('Against a baseline: 0 of 1 scenarios');
    expect(text.indexOf('What needs attention')).toBeLessThan(text.indexOf('Measures by device'));
  });

  it('marks a noisy run, and counts it; a debuggable build is said but is no alarm', async () => {
    const s = store();
    await s.run(2, [launch(700)], { device: EMULATOR, host: 100 });
    await s.run(1, [launch(400)], { build: 'debug' });
    const text = textOf(await s.page());
    expect(text).toContain('noise: high-host-load');
    expect(text).toContain('1 noisy run');
    expect(text).toContain('debug build');
  });

  it('marks a model as an estimate', async () => {
    const s = store();
    await s.run(1, [{ kind: 'energy.mah', unit: 'mah', samples: [0.1], modelled: true }]);
    const text = textOf(await s.page());
    expect(text).toContain('~0.1 mAh');
    expect(text).toContain('estimate, from a model');
  });

  it('gives a refusal newer than any reading', async () => {
    const s = store();
    await s.run(10, [{ kind: 'energy.mah', unit: 'mah', samples: [0.1] }]);
    await saveRefusal(s.dir, {
      deviceClass: PHONE_CLASS,
      measure: 'energy',
      reason: 'batterystats is all zero',
      at: ago(1),
    });
    const text = textOf(await s.page());
    expect(text).toContain('cannot be read');
    expect(text).toContain('batterystats is all zero');
    expect(text).not.toContain('0.1 mAh');
  });

  it('gives a reading newer than a refusal', async () => {
    const s = store();
    await s.run(1, [{ kind: 'energy.mah', unit: 'mah', samples: [0.1] }]);
    await saveRefusal(s.dir, {
      deviceClass: PHONE_CLASS,
      measure: 'energy',
      reason: 'batterystats is all zero',
      at: ago(10),
    });
    const text = textOf(await s.page());
    expect(text).toContain('0.1 mAh');
    expect(text).not.toContain('batterystats is all zero');
  });

  it('says what has not been measured on a device, and that a virtual one is relative', async () => {
    const s = store();
    await s.run(1, [launch(400)]);
    await s.run(1, [launch(700)], { device: EMULATOR });
    const text = textOf(await s.page());
    expect(text).toContain('not measured yet');
    expect(text).toContain('Android emulator');
    expect(text).toContain('Android phone');
    expect(text).toContain(
      'relative to this Mac; real frame rates, frozen frames, hitches and energy need a phone',
    );
  });

  const SIMULATOR: DeviceInfo = {
    serial: 's',
    platform: 'ios',
    model: 'iPhone 17 Pro',
    os: '26.5',
    virtual: true,
  };
  const SURVEY_COMMAND = 'appdyno perf survey --app dev.app --device &#60;id&#62;';

  it('the Launch row holds a plain launch, not the one traced for its phases, if it has one', async () => {
    const s = store();
    await s.run(2, [launch(400)]);
    const phase: Metric = { kind: 'launch.phase.main_ms', unit: 'ms', samples: [500] };
    await s.run(1, [launch(9000), phase], { scenario: 'launch-why' });
    const row = /Launch<\/th>.*?<\/tr>/.exec(await s.page())?.[0] ?? '';
    expect(row).toContain('launch-cold');
    expect(row).not.toContain('launch-why');
    // with nothing else, it stands
    const only = store();
    await only.run(1, [launch(9000), phase], { scenario: 'launch-why' });
    expect(/Launch<\/th>.*?<\/tr>/.exec(await only.page())?.[0]).toContain('launch-why');
  });

  it("a refusal of one app does not stand for another's cell", async () => {
    const s = store();
    await s.run(1, [{ kind: 'heap.leaks', unit: 'count', samples: [20] }], { scenario: 'heap' });
    await s.run(1, [{ kind: 'heap.leaks', unit: 'count', samples: [3] }], {
      scenario: 'heap',
      app: 'other.app',
    });
    await saveRefusal(s.dir, {
      deviceClass: PHONE_CLASS,
      measure: 'leaks',
      app: 'other.app',
      reason: 'it needs get-task-allow',
      at: ago(0),
    });
    const text = textOf(await s.page());
    expect(text.match(/it needs get-task-allow/g)).toHaveLength(1);
    expect(text).toContain('20');
  });

  it('gives each phase of a bar a color of its own, on every device, and one other', async () => {
    const s = store();
    const start = (names: string[]): Metric[] =>
      names.map((n, i) => ({ kind: `launch.phase.${n}_ms`, unit: 'ms', samples: [100 + i] }));
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    await s.run(2, start(many), { scenario: 'launch-why', device: EMULATOR });
    await s.run(1, start(['main', 'uikit', 'frame', 'other', 'load']), { scenario: 'launch-why' });
    const page = await s.page();
    const legends = page.match(/<ul class="legend">.*?<\/ul>/g) ?? [];
    expect(legends).toHaveLength(2);
    for (const legend of legends) {
      const slots = [...legend.matchAll(/class="key s(\d)"/g)].map((m) => m[1]!);
      const painted = slots.filter((c) => c !== '0');
      expect(new Set(painted).size).toBe(painted.length);
      expect(slots.filter((c) => c === '0').length).toBeLessThanOrEqual(1);
      expect(legend.match(/other/g)?.length ?? 0).toBeLessThanOrEqual(1);
    }
  });

  it('with no phone measured for an app, says so with the command for one', async () => {
    const s = store();
    await s.run(1, [launch(700)], { device: EMULATOR });
    const page = await s.page();
    expect(textOf(page)).toContain('No phone has been measured for dev.app.');
    expect(page).toContain(SURVEY_COMMAND);
  });

  it('with a phone measured, says only that a virtual device is relative', async () => {
    const s = store();
    await s.run(1, [launch(400)]);
    await s.run(1, [launch(700)], { device: EMULATOR });
    const page = await s.page();
    expect(textOf(page)).not.toContain('No phone has been measured');
    expect(page).not.toContain(SURVEY_COMMAND);
    expect(textOf(page)).toContain('need a phone');
  });

  it('says in a cell what a number means on a simulator, and not on a phone', async () => {
    const s = store();
    const pacing: Metric[] = [
      { kind: 'frames.jank_percent', unit: 'percent', samples: [3] },
      { kind: 'frames.frozen', unit: 'count', samples: [1] },
      { kind: 'stalls.worst_ms', unit: 'ms', samples: [500] },
    ];
    await s.run(2, [...pacing, { kind: 'energy.mj', unit: 'mj', samples: [207] }], {
      device: SIMULATOR,
    });
    await s.run(1, pacing);
    const page = await s.page();
    const text = textOf(page);
    expect(text).toContain('this Mac&#39;s energy, not a phone&#39;s');
    expect(text.match(/main-thread pacing, on this Mac/g)).toHaveLength(3);
    expect(text).toContain('Frozen frames');
    // an estimate is said on any device
    await s.run(0, [{ kind: 'energy.mj', unit: 'mj', samples: [5], modelled: true }], {
      device: EMULATOR,
    });
    expect(textOf(await s.page())).toContain('estimate, from a model');
  });

  it('shows a kind no measure answers under other', async () => {
    const s = store();
    const xct: Metric = { kind: 'xct.Duration', unit: 'ms', samples: [900] };
    await s.run(2, [xct], { scenario: 'xct' });
    await s.run(1, [xct], { scenario: 'xct' });
    const text = textOf(await s.page());
    expect(text).toContain('other xct.Duration');
    expect(text).toContain('Other: xct.Duration');
  });

  it('calls a regression and a broken budget, and names them', async () => {
    const s = store();
    await baselineAndBudget(s.project);
    await s.run(1, [launch(900)]);
    const text = textOf(await s.page());
    expect(text).toContain('1 regression');
    expect(text).toContain('1 broken budget');
    expect(text).toContain('launch.ttid_ms 903 ms against 403 ms, +500 ms');
    expect(text).toContain('over budget');
  });

  it('has no band for a build with no baseline, and says so', async () => {
    const s = store();
    await s.run(2, [launch(400)]);
    await s.run(1, [launch(410)]);
    const html = await s.page();
    expect(textOf(html)).toContain('no baseline yet');
    expect(html).not.toContain('class="band"');
    expect(html.match(/class="chart"/g)).toHaveLength(1);
  });

  it('draws the band and the budget of a chart with one scale, and a table for it', async () => {
    const s = store();
    await baselineAndBudget(s.project);
    await s.run(2, [launch(400)]);
    await s.run(1, [launch(410)]);
    const html = await s.page();
    expect(html).toContain('class="band"');
    expect(html).toContain('class="limit"');
    expect(textOf(html)).toContain('budget 600 ms');
    expect(html).toContain('<details class="view"><summary>Table: 2 runs</summary>');
  });

  it('gives one small chart per device and kind, with no mixed units', async () => {
    const s = store();
    const metrics: Metric[] = [launch(400), { kind: 'launch.ttfd_ms', unit: 'ms', samples: [600] }];
    for (const minutes of [3, 2, 1]) {
      await s.run(minutes, metrics);
      await s.run(minutes, metrics, { device: EMULATOR });
    }
    expect((await s.page()).match(/class="chart"/g)).toHaveLength(4);
  });

  it('draws the newest launch phases as one split bar with its legend and table', async () => {
    const s = store();
    const phases = ['process_start', 'first_code', 'main', 'did_finish', 'first_frame', 'a', 'b'];
    await s.run(
      1,
      phases.map((p, i) => ({
        kind: `launch.phase.${p}_ms`,
        unit: 'ms' as const,
        samples: [100 * (i + 1)],
      })),
    );
    const html = await s.page();
    expect(html.match(/class="split"/g)).toHaveLength(1);
    // seven phases read as five and the fold of the rest, all seven in the table
    expect(html.match(/class="seg /g)).toHaveLength(6);
    expect(html).toContain('<td>process start</td>');
    expect(textOf(html)).toContain('7 phases, longest b 700 ms');
    expect(textOf(html)).toContain('2,800 ms in all');
  });

  it('gives a section per app with anchors, or the one asked for', async () => {
    const s = store();
    await s.run(1, [launch(400)], { app: 'dev.one' });
    await s.run(1, [launch(400)], { app: 'dev.two' });
    const html = await s.page();
    expect(html).toContain('id="app-dev.one"');
    expect(html).toContain('href="#app-dev.two"');
    const one = await s.page({ app: 'dev.one' });
    expect(one).toContain('id="app-dev.one"');
    expect(one).not.toContain('dev.two');
  });
});

describe('what it reads', () => {
  it('holds when a file is half written, and says what it could not read', async () => {
    const s = store();
    const file = await s.run(2, [launch(400)]);
    await s.run(1, [launch(410)]);
    writeFileSync(file!, '[{"kind":');
    writeFileSync(join(s.project, 'budgets.json'), '{"not": "a list"}');
    const html = await s.page();
    expect(textOf(html)).toContain('Could not read');
    expect(textOf(html)).toContain('413 ms');
  });

  it('leaves out a record it could not show', async () => {
    const s = store();
    const file = await s.run(1, [launch(400)]);
    const held = JSON.parse(readFileSync(file!, 'utf8')) as PerfRecord[];
    writeFileSync(
      file!,
      JSON.stringify([...held, { ...held[0], kind: 'x.bad', value: 'much' }, null]),
    );
    expect(textOf(await s.page())).not.toContain('x.bad');
  });

  it('reads only the newest runs it shows, and says how many there are', async () => {
    const s = store();
    for (let i = 35; i > 0; i--) await s.run(i, [launch(400 + i)]);
    const data = await loadDashboard(s.dir, s.project);
    expect(data.keys[0]!.runs).toHaveLength(30);
    expect(data.keys[0]!.total).toBe(35);
    expect(textOf(renderDashboard(data))).toContain('newest 30 of 35 runs');
  });

  it('writes one index.html, by default beside the runs, and leaves nothing half done', async () => {
    const s = store();
    await s.run(1, [launch(400)]);
    const file = await writeDashboard(s.dir, s.project);
    expect(file).toBe(join(s.dir, 'dashboard', 'index.html'));
    expect(readdirSync(join(s.dir, 'dashboard'))).toEqual(['index.html']);
    const out = mkdtempSync(join(tmpdir(), 'dashboard-out-'));
    const other = await writeDashboard(s.dir, s.project, { out });
    expect(other).toBe(join(out, 'index.html'));
    expect(existsSync(other)).toBe(true);
  });
});
