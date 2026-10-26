import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IosSimulatorDevice } from 'appdyno';

/**
 * The built MCP server over stdio, as an MCP client starts it, against the fixture: on the Android
 * device APPDYNO_ANDROID_SERIAL names and on the simulator APPDYNO_IOS_UDID names (each when given).
 */
const APP = 'dev.appdyno.fixture';
const MAIN = fileURLToPath(new URL('../packages/mcp/dist/main.js', import.meta.url));
const targets = [
  { platform: 'android', serial: process.env.APPDYNO_ANDROID_SERIAL, form: 'FORM' },
  { platform: 'ios', serial: process.env.APPDYNO_IOS_UDID, form: 'Form' },
];

for (const { platform, serial, form } of targets)
  describe.skipIf(!serial)(`appdyno-mcp over stdio (${platform})`, () => {
    let client: Client;
    const stderr: string[] = [];
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const r = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content: { type: string; text?: string }[];
      };
      return {
        error: r.isError === true,
        text: r.content.map((c) => c.text ?? '').join('\n'),
        content: r.content,
      };
    };
    const ref = (text: string, label: string) =>
      new RegExp(`(@[a-z0-9-]+) \\w+ "${label}"`).exec(text)?.[1];

    beforeAll(async () => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          MAIN,
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
      client = new Client({ name: 'stdio-test', version: '0' });
      await client.connect(transport);
    });
    afterAll(async () => {
      await client?.close();
      // the iOS runner does not stay on a shared simulator after the run
      if (platform === 'ios') await new IosSimulatorDevice(serial!).stopAgent();
    });

    it('starts as appdyno and lists its tools', async () => {
      expect(client.getServerVersion()?.title).toBe('appdyno');
      expect((await client.listTools()).tools.length).toBe(27);
    });

    it('drives the fixture: launch, read, tap by ref with a diff, type, screenshot', async () => {
      // a known start: earlier tests may have left another screen of the app on top
      expect((await call('terminate_app')).error).toBe(false);
      const launched = await call('launch_app', { read: 'full' });
      expect(launched.error).toBe(false);
      const home = await call('screen');
      expect(home.text).toContain(`ön planda: ${APP}`);
      const tapped = await call('tap', { ref: ref(home.text, form) });
      expect(tapped.text).toMatch(new RegExp(`^dokunuldu @\\w+ "${form}"`));
      expect(tapped.text).toContain('Adınız');
      const typed = await call('type_text', {
        ref: ref(tapped.text, 'Adınız'),
        text: 'gizli-kod-9911',
        replace: true,
      });
      expect(typed.text).toMatch(/^yazıldı \(14 karakter\)/);
      // the typed secret is never shown back, in the answer or a later read
      const after = await call('screen');
      expect(after.text).not.toContain('gizli-kod-9911');
      expect(after.text).toContain('•••');
      const shot = await call('screenshot');
      expect(shot.content.map((c) => c.type)).toEqual(['text', 'image']);
      expect(stderr.join('')).not.toContain('gizli-kod-9911');
    });

    it('refuses another device and an unsafe link', async () => {
      expect((await call('use_device', { device: 'EXAMPLE0SERIAL00' })).error).toBe(true);
      expect((await call('open_link', { url: 'file:///sdcard/x' })).error).toBe(true);
      expect((await call('launch_app', { app: 'com.android.settings' })).error).toBe(true);
    });
  });
