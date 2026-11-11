import { must } from '@appdyno/core';
import { describe, expect, it, vi } from 'vitest';
import { ServerContext } from '../../src/context.js';
import { DEFAULT_POLICY } from '../../src/policy.js';
import { FakeDevice } from '@appdyno/testing/fake-device.js';
import { REVISIONS } from '@appdyno/testing/calls.js';
import { opsFor } from '../../src/registry.js';
import { type Result, connect, refOf } from './shared.js';

// a virtual device's numbers are noisy under host load: these answers must not depend on this Mac's
vi.mock('node:os', async (original) => ({
  ...(await original<typeof import('node:os')>()),
  loadavg: () => [0, 0, 0],
}));

describe('tool list', () => {
  it('has the device tools with annotations, a title and no shell tool', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toMatchInlineSnapshot(`
      [
        "alert",
        "app",
        "assert",
        "audit",
        "clipboard",
        "crashes",
        "device_info",
        "device_setting",
        "find",
        "flow",
        "gesture",
        "hand_off",
        "inspector",
        "keyboard",
        "launch_app",
        "list_devices",
        "logs",
        "mirror",
        "network",
        "open_link",
        "perf_compare",
        "perf_heap",
        "perf_launch",
        "perf_profile",
        "perf_query",
        "perf_scroll",
        "perf_snapshot",
        "perf_trace",
        "press_key",
        "push",
        "react_native",
        "record",
        "report",
        "screen",
        "screenshot",
        "scroll_to",
        "set_location",
        "set_orientation",
        "simulator",
        "steps",
        "swipe",
        "tap",
        "terminate_app",
        "type_text",
        "use_device",
        "visual",
        "wait_for",
        "webview",
      ]
    `);
    for (const t of tools) {
      expect(t.annotations, t.name).toBeDefined();
      expect(t.outputSchema, t.name).toBeUndefined();
      expect(t.title, t.name).toBeTruthy();
      expect(t.description?.length, t.name).toBeLessThan(400);
    }
    expect(
      tools
        .filter((t) => t.annotations?.readOnlyHint)
        .map((t) => t.name)
        .sort(),
    ).toEqual([
      'assert',
      'audit',
      'crashes',
      'device_info',
      'find',
      'list_devices',
      'logs',
      'perf_heap',
      'perf_query',
      'perf_snapshot',
      'screen',
      'screenshot',
      'visual',
      'wait_for',
    ]);
    expect(tools.length).toBeLessThanOrEqual(48);
  });

  it('reports the server as appdyno with an icon', async () => {
    const { client } = await connect();
    const info = must(client.getServerVersion(), 'the server version');
    expect(info.title).toBe('appdyno');
    expect((info as { icons?: unknown[] }).icons).toHaveLength(1);
  });
});

describe('structured answers', () => {
  it('every answer carries a summary that matches the tool output schema', async () => {
    const t = await connect();
    const sc = async (name: string, args: Record<string, unknown> = {}) =>
      (
        (await t.client.callTool({ name, arguments: args })) as {
          structuredContent?: Record<string, unknown>;
        }
      ).structuredContent;
    const home = (await t.textOf('screen')).text;
    expect(await sc('screen')).toMatchObject({ elements: 3, foreground: 'dev.app', warnings: [] });
    expect(await sc('tap', { ref: refOf(home, 'Form') })).toMatchObject({
      screen: 'full',
      settled: true,
      foreground: 'dev.app',
    });
    expect(await sc('tap', { x: 1, y: 1 })).toMatchObject({
      screen: 'unchanged',
      changes: { added: 0, removed: 0, changed: 0 },
    });
    expect(await sc('list_devices')).toMatchObject({
      devices: [{ serial: 'emulator-5580', allowed: true }],
    });
    expect(await sc('perf_launch')).toMatchObject({
      mode: 'cold',
      medianMs: 600,
      excessive: false,
      virtualDevice: true,
    });
    expect(await sc('find', { text: 'Gönder' })).toMatchObject({
      matches: [{ role: 'button', label: 'Gönder' }],
    });
  });

  it('leaves the text its own field: no summary has a text of its own', () => {
    const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
    expect(Object.values(ops).filter((op) => 'text' in op.output.shape)).toEqual([]);
  });

  describe.each(REVISIONS)(
    'whole in the text alone and in the structured content alone, on %s',
    (revision) => {
      it('the screen, an action with its diff, log lines, and a refusal with its code and hint', async () => {
        const device = new FakeDevice();
        device.logLines = ['E/Fixture: the form failed to load'];
        const t = await connect({}, device, [], revision);
        const both = async (name: string, args: Record<string, unknown> = {}) => {
          const r = (await t.call(name, args)) as Result & {
            structuredContent?: Record<string, unknown>;
          };
          const said = r.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
          const sc = must(r.structuredContent, `${name}'s structured content`);
          expect(sc.text).toBe(said);
          return { said, sc, error: r.isError === true };
        };
        const screen = await both('screen');
        expect(screen.said).toMatch(/button "Form" \d+,\d+/);
        expect(screen.sc).toMatchObject({ elements: 3, foreground: 'dev.app' });
        const tap = await both('tap', { ref: refOf(screen.said, 'Form') });
        expect(tap.sc).toMatchObject({ screen: 'full', changed: true, settled: true });
        expect(tap.said).toContain('button "Gönder"');
        const sent = await both('tap', { ref: refOf(tap.said, 'Gönder') });
        expect(sent.sc).toMatchObject({ screen: 'diff', changes: { added: 1 }, changed: true });
        expect(sent.said).toMatch(/^screen changed: \+1 -0 ~0 .*\n\+ @[\w-]+ text "Gönderildi"/m);
        expect(await both('logs')).toMatchObject({
          said: expect.stringContaining('E/Fixture: the form failed to load') as unknown,
        });
        device.screen = 'login';
        const refusal = await both('tap', { selector: { text: 'Add' } });
        expect(refusal.error).toBe(true);
        expect(refusal.said).toMatch(
          /^AMBIGUOUS: 2 elements match .*\nhint: give the selector an index, or use a ref$/,
        );
        expect(refusal.sc).toMatchObject({
          code: 'AMBIGUOUS',
          hint: 'give the selector an index, or use a ref',
          dispatched: false,
        });
      });
    },
  );
});
