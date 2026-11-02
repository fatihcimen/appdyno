import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IosPhoneDevice } from 'appdyno';

/** The built MCP server over stdio on a real iPhone (APPDYNO_IPHONE_UDID), on Settings: read, open General, screenshot. */
const udid = process.env.APPDYNO_IPHONE_UDID;
const APP = 'com.apple.Preferences';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/mcp-bin.js', import.meta.url));

describe.skipIf(!udid)('appdyno-mcp over stdio (iPhone)', () => {
  let client: Client;
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
        udid!,
        '--app',
        APP,
        '--allow-devices',
        `^${udid}$`,
        '--allow-apps',
        APP,
      ],
      env: process.env as Record<string, string>,
      stderr: 'pipe',
    });
    client = new Client({ name: 'stdio-test', version: '0' });
    await client.connect(transport);
  });
  afterAll(async () => {
    await call('terminate_app').catch(() => undefined);
    await client?.close();
    // the runner does not stay on a shared phone after the run
    await new IosPhoneDevice(udid!).stopAgent();
  });

  it('lists the phone and drives Settings: launch, read, tap by ref, screenshot', async () => {
    expect((await call('list_devices')).text).toContain(`${udid} usb iPhone`);
    expect((await call('launch_app')).error).toBe(false);
    const home = await call('screen');
    expect(home.text).toContain(`foreground: ${APP}`);
    const tapped = await call('tap', { ref: ref(home.text, 'Genel') });
    expect(tapped.text).toMatch(/^tapped @[\w-]+ "Genel"/);
    expect(tapped.text).toContain('Hakkında');
    const shot = await call('screenshot');
    expect(shot.content.map((c) => c.type)).toEqual(['text', 'image']);
  }, 300_000);
});
