import { WHOLE_RUN, type Finding, type GateAnswer, type GateStatus } from './answer.js';
import { deviceLabel, deviceName, when } from './dashboard/format.js';
import { stepName } from './record.js';
import { comparisonLine } from './report.js';

/** Said wherever a virtual device's numbers are: the page's words, and a comment's. */
export const VIRTUAL_IS_RELATIVE =
  'Numbers from an emulator or simulator are relative to this Mac; real frame rates, frozen frames, hitches and energy need a phone.';

const STATUS: Record<GateStatus, string> = {
  regression: 'regression',
  'over-budget': 'over budget',
  noisy: 'noisy, measure again',
  refused: 'not comparable',
  'few-samples': 'too little to call',
  'no-baseline': 'no baseline yet',
  clear: 'no regression',
};

/** One fact of an answer: text, Markdown and the page each set these their own way, and hold nothing else. */
export type Row = { label: string; text: string };

const findingRows = (f: Finding): Row[] => [
  ...(f.place === WHOLE_RUN ? [] : [{ label: 'Step', text: stepName(f.place) }]),
  ...f.worse.map((c) => ({ label: 'What got worse', text: comparisonLine(c) })),
  { label: 'How sure', text: f.sure },
  ...f.causes.map((c, i) => ({ label: i ? 'Also' : 'Likeliest cause', text: c.says })),
  ...f.evidence.map((text) => ({ label: 'Evidence', text })),
  ...f.cannot.map((text) => ({ label: 'Cannot say', text })),
];

export const answerTitle = (a: GateAnswer) =>
  `${STATUS[a.status]}: ${a.app}, ${a.scenario}, ${deviceLabel(deviceName(a.deviceClass, a.device?.model))}`;

/** All an answer says, in order. */
export const answerRows = (a: GateAnswer): Row[] => [
  ...a.findings.flatMap(findingRows),
  ...a.notes.map((text) => ({ label: 'Note', text })),
  ...(a.baseline
    ? [
        {
          label: 'Against',
          text: `${a.baseline.runs} baseline runs, ${when(a.baseline.from)} to ${when(a.baseline.to)}`,
        },
      ]
    : []),
  { label: 'Run', text: a.at ? `${a.run}, ${when(a.at)}` : a.run },
  ...(a.device?.virtual ? [{ label: 'Relative', text: VIRTUAL_IS_RELATIVE }] : []),
];

export const answerText = (a: GateAnswer) =>
  [answerTitle(a), ...answerRows(a).map((r) => `  ${r.label.toLowerCase()}: ${r.text}`)].join('\n');

/** What Markdown would act on: a symbol or a step comes from the app under test, and a comment is posted as it is. */
const plain = (s: string) => s.replace(/[\\`*_{}[\]()#+\-.!|<>~]/g, '\\$&');

export const answerMarkdown = (a: GateAnswer) =>
  [
    `### ${plain(answerTitle(a))}`,
    '',
    ...answerRows(a).map((r) => `- **${r.label}:** ${plain(r.text)}`),
  ].join('\n');
