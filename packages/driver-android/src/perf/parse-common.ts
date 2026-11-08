import { must } from '@appdyno/core';

export const num = (re: RegExp, text: string) => {
  const v = re.exec(text)?.[1];
  return v === undefined ? undefined : Number(v);
};

/** The trace processor's CSV: strings quoted (doubled quotes inside, line breaks allowed), numbers bare. */
export function parseCsv(csv: string): { columns: string[]; rows: string[][] } {
  const table: string[][] = [];
  let row: string[] = [];
  for (const m of csv.matchAll(/("(?:[^"]|"")*"|[^,\n]*)(,|\n|$)/g)) {
    const raw = must(m[1], 'a cell');
    row.push(raw.startsWith('"') ? raw.slice(1, -1).replace(/""/g, '"') : raw);
    if (m[2] !== ',') {
      if (row.some(Boolean)) table.push(row);
      row = [];
    }
    if (m[2] === '') break;
  }
  const [columns = [], ...rows] = table;
  return { columns, rows };
}

/** A cell as a number; the trace processor's NULL is none. */
export const cellNum = (cell: string | undefined) => {
  const v = cell === undefined || cell === '' || cell === '[NULL]' ? NaN : Number(cell);
  return Number.isFinite(v) ? v : undefined;
};

export const nsToMs = (ns: number) => Math.round(ns / 1e5) / 10;
