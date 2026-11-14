/** A file that cannot be read as a flow, at its line. */
export class FlowError extends Error {
  constructor(
    message: string,
    readonly line: number,
  ) {
    super(line ? `line ${line}: ${message}` : message);
  }
}

export type Token = { key?: string; value: string; quoted: boolean };

/** A line's tokens: a word, or `key=value`, with a value in JSON's quotes if it needs them. */
export function tokens(text: string, line: number): Token[] {
  const out: Token[] = [];
  let i = 0;
  const quoted = () => {
    let end = i + 1;
    while (end < text.length && text[end] !== '"') end += text[end] === '\\' ? 2 : 1;
    if (end >= text.length) throw new FlowError('a quote is not closed', line);
    const raw = text.slice(i, end + 1);
    i = end + 1;
    try {
      return JSON.parse(raw) as string;
    } catch {
      throw new FlowError(`not a quoted string: ${raw}`, line);
    }
  };
  const word = () => {
    const start = i;
    while (i < text.length && !/[\s=]/.test(text.charAt(i))) i++;
    return text.slice(start, i);
  };
  while (i < text.length) {
    if (/\s/.test(text.charAt(i))) {
      i++;
      continue;
    }
    if (text[i] === '#') break;
    if (text[i] === '"') {
      out.push({ value: quoted(), quoted: true });
      continue;
    }
    const first = word();
    if (text[i] !== '=') {
      out.push({ value: first, quoted: false });
      continue;
    }
    i++;
    if (text[i] === '"') out.push({ key: first, value: quoted(), quoted: true });
    else {
      const start = i;
      while (i < text.length && !/\s/.test(text.charAt(i))) i++;
      out.push({ key: first, value: text.slice(start, i), quoted: false });
    }
  }
  return out;
}
