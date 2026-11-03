export type TestCase = {
  name: string;
  ms: number;
  failure?: { message: string; detail: string };
  /** What ran, for whoever reads the report: per-step timings. */
  out?: string;
};

export type TestSuite = { name: string; cases: TestCase[] };

// XML 1.0 has no form for most control characters, not even as a reference
// eslint-disable-next-line no-control-regex
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g;
const esc = (s: string) =>
  s
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const seconds = (ms: number) => (ms / 1000).toFixed(3);

/** The report CI systems read: a suite per device, a case per flow. */
export function junitXml(suites: TestSuite[]): string {
  const total = (f: (s: TestSuite) => number) => suites.reduce((n, s) => n + f(s), 0);
  const fails = (s: TestSuite) => s.cases.filter((c) => c.failure).length;
  const time = (s: TestSuite) => s.cases.reduce((n, c) => n + c.ms, 0);
  const body = suites.flatMap((s) => [
    `  <testsuite name="${esc(s.name)}" tests="${s.cases.length}" failures="${fails(s)}" errors="0" time="${seconds(time(s))}">`,
    ...s.cases.flatMap((c) => [
      `    <testcase name="${esc(c.name)}" classname="${esc(s.name)}" time="${seconds(c.ms)}">`,
      ...(c.failure
        ? [`      <failure message="${esc(c.failure.message)}">${esc(c.failure.detail)}</failure>`]
        : []),
      ...(c.out ? [`      <system-out>${esc(c.out)}</system-out>`] : []),
      '    </testcase>',
    ]),
    '  </testsuite>',
  ]);
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${total((s) => s.cases.length)}" failures="${total(fails)}" errors="0" time="${seconds(total(time))}">`,
    ...body,
    '</testsuites>',
    '',
  ].join('\n');
}
