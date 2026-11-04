import { createHash, randomBytes } from 'node:crypto';
import type { Owner } from '@appdyno/core';
import { escapeLiteral, flowText, namesOf, type Flow, type FlowStep } from './format.js';

/** A secret by its salted digest: the recording, on disk and in memory, never holds the value. */
type Known = { name: string; length: number; salt: string; digest: string };

/** A recording as it is kept between the commands that make it. */
export type RecordingState = {
  serial: string;
  app?: string;
  running: boolean;
  steps: FlowStep[];
  known: Known[];
  /** The session it runs in; none is a command line's, and goes on across its commands. */
  owner?: Owner | undefined;
};

const digestOf = (salt: string, value: string) =>
  createHash('sha256').update(salt).update(value).digest('hex');

const paramName = (field: string | undefined) =>
  field
    ?.replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^[^A-Za-z_]+/, '')
    .toUpperCase();

/**
 * What a session did, as a flow's steps. Every string a step is given passes through here, as an app may
 * show back what was typed (a label "Hello <password>" is the next step's selector): the value of a
 * password field and every entry of APPDYNO_SECRETS, wherever they appear, become placeholders.
 */
export class Recording {
  constructor(
    readonly state: RecordingState,
    /** APPDYNO_SECRETS: known to every process, so never written down, not even as a digest. */
    private readonly secrets: string[] = [],
  ) {}

  private named(raw: string): { at: number; length: number; name: string } | undefined {
    for (let at = 0; at < raw.length; at++) {
      for (const k of this.state.known)
        if (
          at + k.length <= raw.length &&
          digestOf(k.salt, raw.slice(at, at + k.length)) === k.digest
        )
          return { at, length: k.length, name: k.name };
      for (const [i, s] of this.secrets.entries())
        if (s && raw.startsWith(s, at)) return { at, length: s.length, name: `SECRET_${i + 1}` };
    }
    return undefined;
  }

  /** A string as a flow holds it: its secrets as placeholders, the rest literal. */
  scrub(raw: string): string {
    const hit = this.named(raw);
    if (!hit) return escapeLiteral(raw);
    return (
      escapeLiteral(raw.slice(0, hit.at)) +
      `\${${hit.name}}` +
      this.scrub(raw.slice(hit.at + hit.length))
    );
  }

  /** Text typed into a password field: from now on it is a secret, named after the field. */
  learnSecret(value: string, field: string | undefined) {
    if (!value || this.named(value)?.length === value.length) return;
    const base = paramName(field) || 'PASSWORD';
    const taken = (n: string) => this.state.known.some((k) => k.name === n);
    let name = base;
    for (let i = 2; taken(name); i++) name = `${base}_${i}`;
    const salt = randomBytes(16).toString('hex');
    this.state.known.push({
      name,
      length: value.length,
      salt,
      digest: digestOf(salt, value),
    });
  }

  add(step: FlowStep) {
    const clean = (v: string | number | boolean) => (typeof v === 'string' ? this.scrub(v) : v);
    const s = step.selector;
    // the first app named is the flow's, when the session had none selected; a step need not repeat it
    const { app, ...rest } = step.args;
    if (typeof app === 'string') this.state.app ??= app;
    const args = app === undefined || app === this.state.app ? rest : step.args;
    this.state.steps.push({
      ...step,
      args: Object.fromEntries(Object.entries(args).map(([k, v]) => [k, clean(v)])),
      ...(s && {
        selector: {
          ...(s.id !== undefined && { id: this.scrub(s.id) }),
          ...(s.role !== undefined && { role: this.scrub(s.role) }),
          ...(s.text !== undefined && { text: this.scrub(s.text) }),
          ...(s.index !== undefined && { index: s.index }),
        },
      }),
    });
  }

  /** The flow so far, each name it uses declared. */
  flow(): Flow {
    return {
      ...(this.state.app && { app: this.state.app }),
      tags: [],
      params: [],
      secrets: [...new Set(this.state.steps.flatMap(namesOf))],
      steps: this.state.steps,
    };
  }

  text = () => flowText(this.flow());
}
