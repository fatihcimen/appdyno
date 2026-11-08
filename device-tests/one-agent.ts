import { subscribe } from 'node:diagnostics_channel';
import { afterEach, expect } from 'vitest';

/**
 * Every suite on a device, by the config: a read that loses its agent starts another and tries again, so a suite passes
 * over it, as mirror.iphone read 14 of 14 while its runner died on every run. An agent is known to be lost at the next
 * connect, so the test that fails may be the one after, and one lost by a file's last call goes unheard. A process
 * started here has its own, which a suite does not hear.
 */
let lost: unknown[] = [];
let meant = 0;

subscribe('appdyno.agent.lost', (m) => {
  if (meant > 0) meant--;
  else lost.push(m);
});

/** This test ends an agent on purpose: the next one found gone is what it did, however late that is found. */
export const agentMayGo = () => {
  meant++;
};

afterEach(() => {
  const gone = lost;
  lost = [];
  expect(gone, 'an agent stopped and a retry hid it').toEqual([]);
});
