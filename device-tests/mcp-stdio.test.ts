import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REVISIONS } from '../packages/ops/test/helpers.js';
import { refIn, toolCaller } from './helpers.js';
import { IosSimulatorDevice } from './workspace.js';

/**
 * The built MCP server over stdio, as an MCP client starts it, against the fixture: on the Android
 * device APPDYNO_ANDROID_SERIAL names and on the simulator APPDYNO_IOS_UDID names (each when given).
 */
const APP = 'dev.appdyno.fixture';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));
const targets = [
  { platform: 'android', serial: process.env.APPDYNO_ANDROID_SERIAL, form: 'FORM' },
  { platform: 'ios', serial: process.env.APPDYNO_IOS_UDID, form: 'Form' },
];

for (const revision of REVISIONS)
  for (const { platform, serial, form } of targets)
    describe.skipIf(!serial)(`appdyno mcp over stdio (${platform}), on ${revision}`, () => {
      let client: Client;
      const stderr: string[] = [];
      const call = toolCaller(() => client);
      const ref = refIn;

      beforeAll(async () => {
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: [
            MAIN,
            'mcp',
            '--device',
            serial!,
            '--app',
            APP,
            '--allow-devices',
            `^${serial}$`,
            '--allow-apps',
            APP,
          ],
          env: { ...(process.env as Record<string, string>), APPDYNO_SECRETS: 'gizli-kod-9911' },
          stderr: 'pipe',
        });
        transport.stderr?.on('data', (d) => stderr.push(String(d)));
        client = new Client(
          { name: 'stdio-test', version: '0' },
          revision === '2026-07-28' ? { versionNegotiation: { mode: { pin: revision } } } : {},
        );
        await client.connect(transport);
        expect(client.getNegotiatedProtocolVersion()).toBe(revision);
      });
      afterAll(async () => {
        await client?.close();
        // the iOS runner does not stay on a shared simulator after the run
        if (platform === 'ios') await new IosSimulatorDevice(serial!).stopAgent();
      });

      it('says how far a long call has got, as it goes', async () => {
        const seen: (string | undefined)[] = [];
        await client.callTool(
          { name: 'wait_for', arguments: { text: 'nothing like it', timeoutMs: 6_000 } },
          { onprogress: (p) => seen.push(p.message) },
        );
        expect(seen).toContain('wait_for: still working (5 s)');
      }, 60_000);

      it('starts as appdyno and lists its tools', async () => {
        expect(client.getServerVersion()?.title).toBe('appdyno');
        const ops = opsFor(new ServerContext(DEFAULT_POLICY, []));
        expect((await client.listTools()).tools.length).toBe(Object.keys(ops).length);
      });

      it('drives the fixture: launch, read, tap by ref with a diff, type, screenshot', async () => {
        // a known start: earlier tests may have left another screen of the app on top
        expect((await call('terminate_app')).error).toBe(false);
        const launched = await call('launch_app', { read: 'full' });
        expect(launched.error).toBe(false);
        const home = await call('screen');
        expect(home.text).toContain(`foreground: ${APP}`);
        const tapped = await call('tap', { ref: ref(home.text, form) });
        expect(tapped.text).toMatch(new RegExp(`^tapped @\\w+ "${form}"`));
        expect(tapped.text).toContain('Your name');
        const typed = await call('type_text', {
          ref: ref(tapped.text, 'Your name'),
          text: 'gizli-kod-9911',
          replace: true,
        });
        expect(typed.text).toMatch(/^typed \(14 characters/);
        // the typed secret is never shown back, in the answer or a later read
        const after = await call('screen');
        expect(after.text).not.toContain('gizli-kod-9911');
        expect(after.text).toContain('•••');
        const shot = await call('screenshot');
        expect(shot.content.map((c) => c.type)).toEqual(['text', 'image']);
        expect(stderr.join('')).not.toContain('gizli-kod-9911');
      });

      it('refuses another device and an unsafe link', async () => {
        expect((await call('use_device', { device: 'another-device' })).error).toBe(true);
        expect((await call('open_link', { url: 'file:///sdcard/x' })).error).toBe(true);
        expect((await call('launch_app', { app: 'com.android.settings' })).error).toBe(true);
      });
    });
