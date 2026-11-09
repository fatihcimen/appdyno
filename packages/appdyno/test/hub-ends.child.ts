// The process of hub-ends.test.ts: a hub whose window has closed while something it started still holds the process,
// as a device's agent still starting does after a quit while it connects.
import { hubCommand } from '../src/mirror-args.js';

process.exitCode = await hubCommand([], {
  context: () => ({ close: () => undefined }),
  hub: () => {
    setInterval(() => undefined, 1_000);
    return Promise.resolve(0);
  },
});
console.log('closed');
