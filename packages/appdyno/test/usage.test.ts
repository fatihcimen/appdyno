import { describe, expect, it } from 'vitest';
import { commandList, COMMANDS, line, usage } from '../src/usage.js';

describe('usage', () => {
  it('says a command as its table has it', () => {
    expect(line('mcp')).toBe(
      'mcp [--device S] [--app A] [--allow-devices RE] [--allow-apps a,b] [--allow-urls RE] [--no-home] [--takeover] [--share] [--animations on|off] [--measurements dir] [--trace-limit-gb N] [--no-install-consent] [--accept-install-warnings] [--http 127.0.0.1:PORT]',
    );
    expect(line('install')).toBe('install [--yes] [--dry-run] [--remove]');
    expect(line('test')).toBe(
      'test <dir or files> [--device S]... [--param NAME=value]... [--env-file F] [--tag T]... [--exclude-tag T]... [--artifacts dir] [--junit file] [--share] [--retries N] [--measure [--iterations N] [--measurements dir]]',
    );
    expect(line('bench')).toBe(
      'bench --serial S [--driver appdyno|<module>]... [--n 50] [--out file] [--max-load N]',
    );
    expect(line('perf survey')).toBe(
      'perf survey --app A [--device S] [--measurements dir] [--share]',
    );
  });

  it('has no flag that skips verifying a release', () => {
    expect(Object.keys(COMMANDS.update.flags).sort()).toEqual(['check', 'help']);
    expect(line('update')).toBe('update [--check]');
  });

  it('leaves out what is between its own processes', () => {
    expect(line('mirror')).toContain('[--all [--watch]]');
    expect(line('mirror')).not.toContain('input-on-click');
    expect(COMMANDS.mirror.flags).toHaveProperty('input-on-click');
  });

  it('answers wrong words with every command they could start', () => {
    expect(
      usage('perf ')
        .split('\n')
        .map((l) => l.trim().split(' ').slice(0, 4)),
    ).toEqual([
      ['usage:', 'appdyno', 'perf', 'compare|baseline|budget'],
      ['appdyno', 'perf', 'functions', '--from'],
      ['appdyno', 'perf', 'prune', '[--limit-gb'],
      ['appdyno', 'perf', 'dashboard', '[--app'],
      ['appdyno', 'perf', 'survey', '--app'],
    ]);
    expect(usage('tools install')).toBe('usage: appdyno tools install');
  });

  it('lists a short command beside what it does, a long one above it', () => {
    const list = commandList().split('\n');
    expect(list).toContain('  devices          the connected devices');
    expect(list).toContain('  ios build        build the iOS runners now');
    const mcp = list.findIndex((l) => l.startsWith('  mcp '));
    expect(list[mcp + 1]).toMatch(/^ {19}the MCP server over stdio/);
  });
});
