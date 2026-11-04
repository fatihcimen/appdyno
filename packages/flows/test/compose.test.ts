import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { composeFlow, flowText, parseFlow, stepLine } from '../src/index.js';

/** A flow's files by absolute path, and what each read asked for. */
const files = (texts: Record<string, string>) => {
  const read: string[] = [];
  const load = (path: string) => {
    read.push(path);
    const text = texts[path];
    if (text === undefined) throw new Error(`no ${path}`);
    return parseFlow(text);
  };
  return { load, read };
};

describe('a flow that runs another', () => {
  it('puts the steps of the other in its place, and says whose they are', () => {
    const { load } = files({
      '/f/a.flow': 'app x\ntap id=first\nrun "login.flow"\ntap id=last\n',
      '/f/login.flow': 'tap id=user\ntap id=go\n',
    });
    const flow = composeFlow('/f/a.flow', load);
    expect(flow.steps.map(stepLine)).toEqual([
      'tap id=first',
      'tap id=user',
      'tap id=go',
      'tap id=last',
    ]);
    expect(flow.steps.map((s) => [s.file, s.line])).toEqual([
      [undefined, 2],
      ['/f/login.flow', 1],
      ['/f/login.flow', 2],
      [undefined, 4],
    ]);
  });

  it('finds a path from the file that names it, at any depth', () => {
    const { load, read } = files({
      '/f/a.flow': 'run sub/b.flow\n',
      '/f/sub/b.flow': 'run ../shared/c.flow\n',
      '/f/shared/c.flow': 'launch\n',
    });
    expect(composeFlow('/f/a.flow', load).steps.map((s) => s.file)).toEqual(['/f/shared/c.flow']);
    expect(read).toEqual(['/f/a.flow', '/f/sub/b.flow', '/f/shared/c.flow']);
  });

  it('takes a relative path to the first file', () => {
    const top = resolve('here/a.flow');
    const { load } = files({ 'here/a.flow': 'run b.flow\n', [resolve('here/b.flow')]: 'launch\n' });
    expect(composeFlow('here/a.flow', load).steps[0]!.file).toBe(`${dirname(top)}/b.flow`);
  });

  it('asks for the names of every file, a name secret in one being secret in all', () => {
    const { load } = files({
      '/f/a.flow': 'tag smoke\nparam USER\nparam CODE\nrun b.flow\ntype "${USER}"\n',
      '/f/b.flow': 'tag other\nparam USER\nparam PLACE\nsecret CODE\ntype "${PLACE}${CODE}"\n',
    });
    const flow = composeFlow('/f/a.flow', load);
    expect(flow.params).toEqual(['USER', 'CODE', 'PLACE']);
    expect(flow.secrets).toEqual(['CODE']);
    expect(flow.tags).toEqual(['smoke']);
  });

  it('runs one file twice, which is no cycle', () => {
    const { load } = files({
      '/f/a.flow': 'run b.flow\nrun c.flow\nrun b.flow\n',
      '/f/b.flow': 'run d.flow\n',
      '/f/c.flow': 'run d.flow\n',
      '/f/d.flow': 'launch\n',
    });
    expect(composeFlow('/f/a.flow', load).steps).toHaveLength(3);
  });

  it('refuses a file that runs itself, by itself or through others, naming the way round', () => {
    expect(() => composeFlow('/f/a.flow', files({ '/f/a.flow': 'run a.flow\n' }).load)).toThrow(
      '/f/a.flow:1: a flow cannot run itself: /f/a.flow runs /f/a.flow',
    );
    const { load, read } = files({
      '/f/a.flow': 'launch\nrun b.flow\n',
      '/f/b.flow': 'launch\n\nrun sub/../c.flow\n',
      '/f/c.flow': 'run a.flow\n',
    });
    expect(() => composeFlow('/f/a.flow', load)).toThrow(
      '/f/c.flow:1: a flow cannot run itself: /f/a.flow runs /f/b.flow runs /f/c.flow runs /f/a.flow',
    );
    expect(read).toHaveLength(3);
  });

  it('refuses a flow for another app, and takes the app of one that names it', () => {
    const { load } = files({
      '/f/a.flow': 'app one\nrun b.flow\n',
      '/f/b.flow': 'app two\nlaunch\n',
      '/f/c.flow': 'run a.flow\n',
      '/f/d.flow': 'run e.flow\n',
      '/f/e.flow': 'app two\nlaunch\n',
    });
    expect(() => composeFlow('/f/a.flow', load)).toThrow(
      '/f/a.flow:2: /f/b.flow is for two, this flow for one',
    );
    expect(composeFlow('/f/d.flow', load).app).toBe('two');
  });

  it('keeps the step as it was written in a file', () => {
    expect(flowText(parseFlow('run "my flows/b.flow"\n'))).toBe('run "my flows/b.flow"\n');
  });
});
