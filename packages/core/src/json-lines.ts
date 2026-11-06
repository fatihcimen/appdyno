/**
 * What a helper writes, as what each whole line says in JSON. A line that is none goes nowhere, as a framework may
 * print on a process's stdout, and bytes are kept as they come, as a chunk may end inside a character.
 */
export function jsonLines(heard: (message: unknown) => void) {
  let held: Buffer[] = [];
  return (chunk: Buffer) => {
    let start = 0;
    for (let end = chunk.indexOf(10); end >= 0; end = chunk.indexOf(10, start)) {
      const line = Buffer.concat([...held, chunk.subarray(start, end)]);
      held = [];
      start = end + 1;
      let message: unknown;
      try {
        message = JSON.parse(line.toString('utf8'));
      } catch {
        continue;
      }
      heard(message);
    }
    if (start < chunk.length) held.push(chunk.subarray(start));
  };
}
