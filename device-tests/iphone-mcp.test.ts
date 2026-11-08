import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { refIn, toolCaller } from './helpers.js';
import { IosPhoneDevice } from './workspace.js';

/** The built MCP server over stdio on a real iPhone (APPDYNO_IPHONE_UDID), on Settings: read, open General, screenshot. */
const udid = process.env.APPDYNO_IPHONE_UDID ?? '';
const APP = 'com.apple.Preferences';
const MAIN = fileURLToPath(new URL('../packages/appdyno/dist/main.js', import.meta.url));

describe.skipIf(!udid)('appdyno mcp over stdio (iPhone)', () => {
  let client: Client;
  const call = toolCaller(() => client);
  const ref = refIn;

  beforeAll(async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        MAIN,
        'mcp',
        '--device',
        udid,
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
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- unset where beforeAll failed
    await client?.close();
    // the runner does not stay on a shared phone after the run
    await new IosPhoneDevice(udid).stopAgent();
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
