import type { ListedPhone } from '../src/devicectl.js';

/** A paired phone in Developer Mode, on an iOS the runner takes. */
export const fine: ListedPhone = {
  connectionProperties: { pairingState: 'paired' },
  deviceProperties: { developerModeStatus: 'enabled', osVersionNumber: '27.2' },
};

/** A device tool whose reads each take a moment, saying when each starts and ends. */
export function slowDevicectl(
  listed: () => ListedPhone | undefined,
  lock: () => { passcodeRequired: boolean } = () => ({ passcodeRequired: false }),
) {
  const log: string[] = [];
  const read = <T>(what: string, answer: () => T) => {
    log.push(what);
    return new Promise<T>((done, fail) =>
      setTimeout(() => {
        log.push(`${what} done`);
        try {
          done(answer());
        } catch (e) {
          fail(e instanceof Error ? e : new Error(String(e)));
        }
      }, 5),
    );
  };
  return { log, listed: () => read('list', listed), lockState: () => read('lock', lock) };
}

/** Both reads began before either ended. */
export const overlapped = (log: string[]) => log.slice(0, 2).toSorted().join() === 'list,lock';
