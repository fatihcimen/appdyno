import { xmlText } from '@appdyno/core';
export type CaseFailure = { message: string; detail: string };

export type TestCase = {
  name: string;
  ms: number;
  failure?: CaseFailure;
  /** The attempts that failed before the last. With no `failure` the case passed only on a retry: it is flaky. */
  retried?: CaseFailure[];
  /** What ran, for whoever reads the report: per-step timings. */
  out?: string;
};

export type TestSuite = { name: string; cases: TestCase[] };

const seconds = (ms: number) => (ms / 1000).toFixed(3);

export const isFlaky = (c: TestCase) => !c.failure && !!c.retried?.length;

/**
 * The report CI systems read: a suite per device, a case per flow. A retried case holds its failed attempts as
 * Surefire's report does, `flakyFailure` when it passed in the end and `rerunFailure` when it did not.
 */
export function junitXml(suites: TestSuite[]): string {
  const total = (f: (s: TestSuite) => number) => suites.reduce((n, s) => n + f(s), 0);
  const fails = (s: TestSuite) => s.cases.filter((c) => c.failure).length;
  const flakes = (s: TestSuite) => s.cases.filter(isFlaky).length;
  const time = (s: TestSuite) => s.cases.reduce((n, c) => n + c.ms, 0);
  const attempt = (tag: string, a: CaseFailure) =>
    `      <${tag} message="${xmlText(a.message)}" type="flow"><stackTrace>${xmlText(a.detail)}</stackTrace></${tag}>`;
  const body = suites.flatMap((s) => [
    `  <testsuite name="${xmlText(s.name)}" tests="${s.cases.length}" failures="${fails(s)}" errors="0" flakes="${flakes(s)}" time="${seconds(time(s))}">`,
    ...s.cases.flatMap((c) => [
      `    <testcase name="${xmlText(c.name)}" classname="${xmlText(s.name)}" time="${seconds(c.ms)}">`,
      ...(c.failure
        ? [
            `      <failure message="${xmlText(c.failure.message)}">${xmlText(c.failure.detail)}</failure>`,
          ]
        : []),
      ...(c.retried ?? []).map((a) => attempt(c.failure ? 'rerunFailure' : 'flakyFailure', a)),
      ...(c.out ? [`      <system-out>${xmlText(c.out)}</system-out>`] : []),
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
