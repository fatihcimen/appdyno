import { describe, expect, it } from 'vitest';
import { crashReports, parseDropbox, parseExitInfo } from '../src/crashes.js';
import { conflictHint, holdersIn, PROCESS_LIST } from '../src/holders.js';
import type { Adb } from '../src/adb.js';
import { androidLogs, logcatCommand, markOfLine } from '../src/logs.js';

const line = (pid: number, command: string, user = 'shell') =>
  `${String(pid).padStart(6)} ${user} ${command}`;

describe('who holds UI automation', () => {
  it.each([
    ['com.example.automation.Server --idle-timeout-ms=1800000', 'app_process', /^kill 901$/],
    ['com.example.automation.Server', 'app_process', /^kill 901$/],
    ['app_process /system/bin com.example.automation.Server', 'app_process', /^kill 901$/],
    ['/system/bin/app_process64 / com.example.automation.Server', 'app_process', /^kill 901$/],
    [
      'am instrument -w -r -e session s1 com.example.automation.test/androidx.test.runner.AndroidJUnitRunner',
      'instrumentation',
      /^am force-stop com\.example\.automation$/,
    ],
    ['am instrument -w', 'instrumentation', /^kill 901$/],
    ['com.example.automation.test', 'instrumentation', /^am force-stop com\.example\.automation$/],
    [
      'com.example.automation.test:remote',
      'instrumentation',
      /^am force-stop com\.example\.automation$/,
    ],
    [
      'io.appium.uiautomator2.server.test',
      'instrumentation',
      /^am force-stop io\.appium\.uiautomator2\.server$/,
    ],
    [
      'io.appium.uiautomator2.server',
      'instrumentation',
      /^am force-stop io\.appium\.uiautomator2\.server$/,
    ],
    ['uiautomator events', 'uiautomator', /^kill 901$/],
    ['/system/bin/uiautomator dump', 'uiautomator', /^kill 901$/],
    [
      'app_process /system/bin com.android.commands.uiautomator.Launcher events',
      'uiautomator',
      /^kill 901$/,
    ],
  ])('recognises %s', (command, tool, stop) => {
    const ps = ['  PID USER ARGS', line(1, 'init second_stage', 'root'), line(901, command)].join(
      '\n',
    );
    const [h] = holdersIn(ps);
    expect(h).toMatchObject({ tool, pid: 901, command });
    expect(h?.shell).toMatch(stop);
  });

  it('leaves out what holds nothing: others, our agent, the shell that started it, ps itself', () => {
    expect(
      holdersIn(
        [
          line(1, 'init second_stage'),
          line(2, 'zygote64'),
          line(3, 'app_process / dev.appdyno.agent.Main --socket s'),
          line(4, 'sh -c uiautomator events > /dev/null'),
          line(5, 'ps -A -o PID,ARGS'),
          line(6, 'grep uiautomator'),
          line(7, 'com.example.uiautomatorish'),
          line(8, 'com.example.shop'),
          line(9, 'com.Company.Game'),
          line(10, 'com.android.systemui:ui'),
        ].join('\n'),
      ),
    ).toEqual([]);
  });

  it('an instrumented package counts under its own user, as it runs as the app it tests', () => {
    expect(holdersIn(line(901, 'com.example.automation.test', 'u0_a123'))[0]).toMatchObject({
      tool: 'instrumentation',
      shell: 'am force-stop com.example.automation',
    });
  });

  it.each([
    ['an app whose process name looks like a class', 'com.example.games.Puzzle', 'u0_a123'],
    ['an app that runs app_process', 'app_process / com.example.Server', 'u0_a123'],
    ['a system service', 'app_process64 /system/bin com.vendor.daemon.Main', 'root'],
    ['the system', 'com.android.server.Helper', 'system'],
    ['a screen mirror', 'app_process / com.genymobile.scrcpy.Server 2.7', 'shell'],
  ])('--takeover never stops %s', (_, command, user) => {
    expect(holdersIn(line(901, command, user))).toEqual([]);
  });

  it('names one holder once per way to stop it', () => {
    const hs = holdersIn(
      [
        line(10, 'com.example.automation.test'),
        line(11, 'sh -c am instrument -w com.example.automation.test/.R'),
      ].join('\n'),
    );
    expect(hs.map((h) => h.shell)).toEqual(['am force-stop com.example.automation']);
  });

  it('says the exact command, and what to do when no holder is known', () => {
    const hint = conflictHint(holdersIn(line(77, 'uiautomator events')), 'emulator-5612');
    expect(hint).toContain('uiautomator (pid 77)');
    expect(hint).toContain('`uiautomator events`');
    expect(hint).toContain('`adb -s emulator-5612 shell kill 77`');
    expect(hint).toContain('--takeover');
    expect(conflictHint([], 'emulator-5612')).toContain(
      `adb -s emulator-5612 shell ${PROCESS_LIST}`,
    );
  });
});

describe('logs', () => {
  it('asks logcat for the app, the level and the time', () => {
    expect(logcatCommand('42', { since: 1_730_000_000_123, level: 'warn', maxLines: 5 })).toBe(
      "logcat -d --pid=42 -v threadtime -t 1730000000.123 '*:W'",
    );
    expect(logcatCommand('42', { level: 'info', maxLines: 5 })).toContain('-t 5 ');
  });

  it('asks for the time on each line when it is to be placed', () => {
    expect(logcatCommand('42', { level: 'info', maxLines: 5, timed: true })).toContain(
      '-v threadtime -v epoch ',
    );
  });

  it('reads a line as this logcat prints it: indented, with its time and rank', () => {
    expect(
      markOfLine('         1793841365.998  6178  6178 I Choreographer: Skipped 47 frames!'),
    ).toEqual({ at: 1793841365998 });
    expect(markOfLine('1793841366.022  6178  6260 W OpenGLRenderer: Davey!')).toEqual({
      at: 1793841366022,
      level: 'warn',
    });
    expect(markOfLine('1793841366.022  6178  6260 E App: failed')?.level).toBe('error');
    expect(markOfLine('1793841366.022  6178  6260 F libc: Fatal signal')?.level).toBe('error');
  });

  it('gives no place to what is not a line', () => {
    expect(markOfLine('--------- beginning of main')).toBeUndefined();
    expect(markOfLine('11-05 04:16:06.022  6178  6260 I OpenGLRenderer: Davey!')).toBeUndefined();
  });

  // a phone ends a crashed process at once (an emulator's dialog holds it), and may start the app anew
  const FATAL = '11-02 23:59:33.010  6374  6374 E AndroidRuntime: FATAL EXCEPTION: main';
  const afterCrash = (running: string) => {
    const asked: string[] = [];
    const adb = {
      exec: (_serial: string, c: string) => {
        asked.push(c);
        return Promise.resolve(
          c.startsWith('pidof') ? running : c.includes('exit-info') ? EXIT_INFO : `${FATAL}\n`,
        );
      },
    } as unknown as Adb;
    return { adb, asked };
  };
  const query = { app: 'dev.appdyno.fixture', level: 'info' as const, maxLines: 50 };

  it('reads what a process wrote as it died, by the pid the system says ended', async () => {
    const { adb, asked } = afterCrash('');
    const r = await androidLogs(adb, 'R1', query);
    expect(r.lines).toEqual([FATAL]);
    expect(r.source).toBe('logcat --pid=6374');
    expect(r.note).toContain('not running');
    expect(asked.at(-1)).toBe(`[ -e /proc/6374 ] || ${logcatCommand('6374', query)}`);
  });

  it('reads the process that died before the one started after it', async () => {
    const { adb, asked } = afterCrash('7001\n');
    const r = await androidLogs(adb, 'R1', query);
    expect(r.source).toBe('logcat --pid=6374,7001');
    expect(r.note).toBeUndefined();
    expect(asked.at(-1)).toBe(
      `[ -e /proc/6374 ] || ${logcatCommand('6374', query)}; ${logcatCommand('7001', query)}`,
    );
  });

  it('reads only the process asked for', async () => {
    const { adb, asked } = afterCrash('');
    const r = await androidLogs(adb, 'R1', { ...query, pid: '42' });
    expect(r.source).toBe('logcat --pid=42');
    expect(asked).toEqual([logcatCommand('42', query)]);
  });
});

// as `dumpsys activity exit-info` and `dumpsys dropbox --print` print on API 34
const EXIT_INFO = `ACTIVITY MANAGER PROCESS EXIT INFO (dumpsys activity exit-info)
Last Timestamp of Persistence Into Persistent Storage: 1970-01-01 02:00:00.000
  package: dev.appdyno.fixture
    Historical Process Exit for uid=10193
        ApplicationExitInfo #0:
          timestamp=2026-11-02 23:59:33.030 pid=6374 realUid=10193 packageUid=10193 definingUid=10193 user=0
          process=dev.appdyno.fixture reason=4 (APP CRASH(EXCEPTION)) subreason=0 (UNKNOWN) status=0
          importance=100 pss=0.00 rss=0.00 description=crash state=empty trace=null
        ApplicationExitInfo #1:
          timestamp=2026-11-02 23:50:01.000 pid=6000 realUid=10193 packageUid=10193 definingUid=10193 user=0
          process=dev.appdyno.fixture reason=10 (USER REQUESTED) subreason=0 (UNKNOWN) status=0
          importance=100 pss=0.00 rss=0.00 description=stop state=empty trace=null
`;
const DROPBOX = `Drop box contents: 57 entries
Max entries: 1000
Searching for: data_app_crash

========================================
2026-11-02 23:59:34 data_app_crash (text, 1097 bytes)
Process: dev.appdyno.fixture
PID: 6374
Flags: 0x2088be46
Package: dev.appdyno.fixture v1 (0.1.0)
Foreground: Yes

android.app.RemoteServiceException$CrashedByAdbException: shell-induced crash
	at android.app.ActivityThread.throwRemoteServiceException(ActivityThread.java:2090)
	at android.os.Looper.loop(Looper.java:294)

========================================
2026-11-02 23:00:00 data_app_crash (text, 900 bytes)
Process: com.other.app
PID: 1

java.lang.RuntimeException: not ours
`;

describe('crashes', () => {
  it('reads the exits that are deaths, not a stop someone asked for', () => {
    expect(parseExitInfo(EXIT_INFO)).toEqual([
      expect.objectContaining({
        at: '2026-11-02 23:59:33.030',
        reason: 'APP CRASH(EXCEPTION)',
        detail: 'crash',
      }),
    ]);
  });

  it('reads the dropbox entries of this app only', () => {
    const drops = parseDropbox(DROPBOX, 'dev.appdyno.fixture');
    expect(drops).toHaveLength(1);
    expect(drops[0]?.tag).toBe('data_app_crash');
  });

  it('joins an exit with its stack and keeps to the time asked', () => {
    const q = { app: 'dev.appdyno.fixture', limit: 5 };
    const [r] = crashReports(EXIT_INFO, DROPBOX, q);
    expect(r?.reason).toBe('APP CRASH(EXCEPTION)');
    expect(r?.detail).toContain('shell-induced crash');
    expect(
      crashReports(EXIT_INFO, DROPBOX, {
        ...q,
        since: new Date('2026-11-03T00:00:00').getTime(),
      }),
    ).toEqual([]);
  });
});
