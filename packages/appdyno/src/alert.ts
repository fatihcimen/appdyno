import { spawn } from 'node:child_process';

const SOUND = '/System/Library/Sounds/Glass.aiff';

const quietly = (command: string, args: string[]) => {
  const p = spawn(command, args, { stdio: 'ignore', detached: true });
  p.on('error', () => undefined);
  p.unref();
};

/**
 * No window to show a request in: a sound, and a notification where the system lets one through. Best
 * effort: nothing waits on either and a notification needs no permission to be asked for. Not run by any
 * test, as it reaches a person: a hand-run step (docs/reference/ci.md). The reason goes as an argument, never as script.
 */
function alertPerson(reason: string) {
  quietly('afplay', [SOUND]);
  quietly('osascript', [
    '-e',
    'on run argv',
    '-e',
    'display notification (item 1 of argv) with title "appdyno needs you"',
    '-e',
    'end run',
    reason,
  ]);
}

/** What `hand_off` sounds and shows with no window: nothing on a server run `--silent` or with APPDYNO_SILENT=1, as CI and a shared Mac are. */
export const alertOf = (silent: boolean | undefined, env: NodeJS.ProcessEnv = process.env) =>
  silent === true || env.APPDYNO_SILENT === '1' ? undefined : alertPerson;
