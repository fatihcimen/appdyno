import { measuredLive, perfMessage, type ViewerTold } from '@appdyno/core';
import type { WindowParts } from './controls.js';
import { MEASURE_YOURS, PERSON_HINTS, WAKE_AND_OPEN, type WindowMeasures } from './measures.js';

/** How often a device's own source is told what is in front: one call to its agent while that stays the same. */
const APP_LOOK_MS = 5_000;

/**
 * A window's Perf pane: live numbers while it shows, what was measured here before, and a measure at a time, which has
 * the device to itself.
 */
export function windowPerf(parts: WindowParts, measures: WindowMeasures) {
  const { device, hardware, session, ready, note } = parts;
  let stopPerf: (() => unknown) | undefined;
  let readingsWanted = false;
  let measuring = false;
  let readingsTurn: Promise<void> = Promise.resolve();

  const inFront = () => device.frontApp?.() ?? device.foreground();

  /**
   * A device's own source where it has one, or its measures: nothing is read while nothing shows it, nor while a measure
   * runs, whose counts a reading would reset.
   */
  const followReadings = async () => {
    await stopPerf?.();
    stopPerf = undefined;
    if (!readingsWanted || measuring) return;
    // only a device that has no way to say what is in front but its agent starts it: a late answer is no refusal
    let front: string | undefined;
    const refused = await inFront().then(
      (app) => void (front = app),
      () => true,
    );
    if (refused) void ready().catch(() => undefined);
    // its measures ask each turn what is in front; a device's own source reads the app it is given, and is told again
    const own = device.liveMetrics;
    const live = own ?? measuredLive(device);
    const stop = await live.start(
      (sample) => session().tell(perfMessage(sample)),
      own ? front : undefined,
    );
    void tellHistory(front).catch(() => undefined);
    // a person moves on, and the numbers go with them: a device's own source starts again on the new app, and the
    // pane's measures and results follow either way
    const looking = setInterval(() => {
      void inFront()
        .catch(() => front)
        .then((now) => {
          if (now === front || !stopPerf) return;
          if (own) return turnReadings();
          front = now;
          return tellHistory(now);
        })
        .catch(() => undefined);
    }, APP_LOOK_MS);
    stopPerf = () => {
      clearInterval(looking);
      return stop();
    };
  };

  /** One at a time: a window quickly closed must not leave a source that started late running. */
  const turnReadings = () => (readingsTurn = readingsTurn.then(followReadings, followReadings));

  const tellMeasured = (m: ViewerTold<'measured'>) => session().tell({ op: 'measured', ...m });

  /**
   * What was measured here before, with the app's own name: a person never reads its id. What is not an app of theirs
   * has no name, and the pane goes back to asking for one.
   */
  const tellHistory = async (app: string | undefined) => {
    const known = app ? await device.apps.listApps(false).catch(() => []) : [];
    const name = known.find((a) => a.id === app)?.name;
    session().tell({
      op: 'results',
      results: app ? await measures.history(app) : [],
      ...(name && { app: name }),
    });
  };
  // a tool's progress names the device by its id, as `connecting to <udid>`: a person reads its name
  const person = hardware?.name ?? hardware?.model;
  const id = new RegExp(
    `(?<![\\w-])${device.serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`,
    'g',
  );
  const saying = (line: string) =>
    session().tell({ op: 'measuring', line: person ? line.replace(id, person) : line });

  /** A measure has the device to itself: nothing reads over what it counts, and no second one starts. */
  const alone = async <T>(work: () => Promise<T>) => {
    if (measuring) {
      note('A measure is running');
      return undefined;
    }
    measuring = true;
    try {
      saying('Starting the device agent');
      await turnReadings();
      await ready();
      return await work();
    } catch (e) {
      // a refusal says what to do next, which is the person's to do here, in their words
      const { message, hint } = e as Error & { hint?: string };
      const said = hint && PERSON_HINTS.get(hint);
      // what failed is the first line: a flow's names its file first, which the person chose, and then what the screen held
      const detail = (message.split('\n')[0] ?? '').replace(/^.*\.flow:\d+: /, '');
      tellMeasured({ title: 'No measure', detail, ...(said && { hint: said }) });
      return undefined;
    } finally {
      measuring = false;
      await turnReadings();
    }
  };

  return {
    /** A measure runs: what reads the screen stays out of its numbers. */
    measuring: () => measuring,

    /** The numbers are wanted while the pane shows, and no longer once it does not. */
    want(on: boolean) {
      readingsWanted = on;
      return turnReadings();
    },

    /** A real measure of the app in front, by the tools an agent calls: what is the system's is not measured. */
    measure: (work: WindowMeasures['launch']) =>
      alone(async () => {
        const { app, mine } = await parts.frontApp();
        if (!app || !mine) {
          // the row's line is short; what to do is the note's, which a pane shows whole
          tellMeasured({
            title: 'Open an app first',
            detail: app ? `${app} is in front` : 'No app is in front',
            hint: app ? MEASURE_YOURS : WAKE_AND_OPEN,
          });
          return;
        }
        const newest = async () => (await measures.history(app).catch(() => []))[0]?.why;
        const was = await newest();
        const said = await work(app, saying);
        // a line the Mac keeps stands in for this one in the pane, and one with no number to keep stays as it is
        tellMeasured({ ok: true, ...said, kept: (await newest()) !== was });
        await tellHistory(app);
      }),

    /** A flow as a measure, with what a window beside this one needs to compare it. */
    journey: (file: string) =>
      alone(async () => {
        const front = await parts.frontApp().catch(() => undefined);
        const { said, ran } = await measures.journey(
          file,
          front?.mine ? front.app : undefined,
          saying,
        );
        tellMeasured({ ok: true, ...said });
        return ran;
      }),

    /** The numbers stop with the window. */
    async end() {
      readingsWanted = false;
      await turnReadings();
    },
  };
}
