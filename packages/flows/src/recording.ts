import { createHash, randomBytes } from 'node:crypto';
import type { Owner } from '@appdyno/core';
import {
  escapeLiteral,
  flowText,
  FlowError,
  isName,
  mapStrings,
  namesOf,
  type Flow,
  type FlowStep,
} from './format.js';

/** A secret, or a param an agent named, by its salted digest: the recording, on disk and in memory, never holds the value. */
type Known = { name: string; length: number; salt: string; digest: string; param?: boolean };

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

const knownAs = (name: string, value: string): Known => {
  const salt = randomBytes(16).toString('hex');
  return { name, length: value.length, salt, digest: digestOf(salt, value) };
};

/** A recorded string's literal parts apart from its placeholders and escapes, which stand between them. */
const PARTS = /(\$\$\{|\$\{[^}]*\})/;

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
    this.state.known.push(knownAs(name, value));
  }

  /**
   * A value the agent names: from now on, and in the steps held already, it is `${name}`, a param a run is given. A
   * secret's name is refused, as one name is one thing.
   */
  nameParam(name: string, value: string) {
    if (!isName(name)) throw new FlowError(`a param's name is like MY_NAME: ${name}`, 0);
    if (!value) throw new FlowError(`${name} has no value to name`, 0);
    if (this.state.known.some((k) => k.name === name && !k.param))
      throw new FlowError(`${name} is a secret's name in this recording`, 0);
    this.state.known = [
      ...this.state.known.filter((k) => k.name !== name),
      { ...knownAs(name, value), param: true },
    ];
    // shortcut: a value with "${" in it is not found in the steps held before it was named
    const named = (s: string) =>
      s
        .split(PARTS)
        .map((part, i) => (i % 2 ? part : part.split(value).join(`\${${name}}`)))
        .join('');
    this.state.steps = this.state.steps.map((st) => mapStrings(st, named));
  }

  add(step: FlowStep) {
    // the first app named is the flow's, when the session had none selected; a step need not repeat it
    const { app, ...rest } = step.args;
    if (typeof app === 'string') this.state.app ??= app;
    const args = app === undefined || app === this.state.app ? rest : step.args;
    this.state.steps.push(mapStrings({ ...step, args }, (v) => this.scrub(v)));
  }

  /** The last steps turn out to have been this one, as a second tap makes two taps a double tap. */
  rewrite(count: number, step: FlowStep) {
    this.state.steps.length -= count;
    this.add(step);
  }

  /** The flow so far, each name it uses declared: what the agent named as a param, the rest as a secret. */
  flow(): Flow {
    const names = [...new Set(this.state.steps.flatMap(namesOf))];
    const param = (n: string) => this.state.known.some((k) => k.name === n && k.param);
    return {
      ...(this.state.app && { app: this.state.app }),
      tags: [],
      params: names.filter(param),
      secrets: names.filter((n) => !param(n)),
      steps: this.state.steps,
    };
  }

  text = () => flowText(this.flow());
}
