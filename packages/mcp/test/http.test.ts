import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DeviceProvider, DeviceSettings, SettingName } from '@appdyno/core';
import { DEFAULT_POLICY, opsFor, ServerContext } from '@appdyno/ops';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDevice } from '../../ops/test/fake-device.js';
import { listenOn, serveHttp } from '../src/http.js';

const TOKEN = 'a-token-of-the-length-it-should-have';
const bearer = { authorization: `Bearer ${TOKEN}` };

const stops: (() => Promise<void>)[] = [];

/** A server with one fake device; the settings show whether a client's conditions went back. */
async function serving(idleMs?: number) {
  const dark = { value: 'no' };
  const settings = {
    get: async () => dark.value,
    set: vi.fn(async (_: SettingName, value: string) => {
      dark.value = value;
    }),
  } as unknown as DeviceSettings;
  const device = Object.assign(new FakeDevice(), { settings });
  const provider: DeviceProvider = {
    list: async () => [{ serial: device.serial, state: 'device', ready: true }],
    handles: () => true,
    open: () => device,
  };
  const contexts: ServerContext[] = [];
  const log = vi.fn();
  const http = await serveHttp({
    host: '127.0.0.1',
    port: 0,
    token: TOKEN,
    open: () => {
      const ctx = new ServerContext(DEFAULT_POLICY, [provider], { claims: true });
      contexts.push(ctx);
      return { ops: opsFor(ctx), end: () => ctx.end().then(() => ctx.close()) };
    },
    log,
    ...(idleMs !== undefined && { idleMs }),
  });
  stops.push(http.stop);
  return { ...http, dark, device, contexts, log };
}

/** A real client of the SDK, by header unless given a URL with the token in it. */
async function clientOf(url: string, name = 'first', headers: Record<string, string> = bearer) {
  const client = new Client({ name, version: '1' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } }),
  );
  return client;
}

const post = (url: string, headers: Record<string, string>, body = '{}') =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body,
  });

const text = (r: unknown) =>
  (r as { content: { type: string; text?: string }[] }).content.map((c) => c.text ?? '').join('\n');

beforeEach(() => {
  vi.stubEnv('APPDYNO_STATE_DIR', mkdtempSync(join(tmpdir(), 'appdyno-http-')));
});

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
});

describe('what may call it', () => {
  it('refuses a request with no token, or the wrong one, and names the scheme', async () => {
    const { url, log } = await serving();
    for (const authorization of [undefined, 'Bearer not-it', TOKEN]) {
      const r = await post(url, authorization ? { authorization } : {});
      expect(r.status).toBe(401);
      expect(r.headers.get('www-authenticate')).toBe('Bearer');
    }
    expect((await post(`${url}/not-it`, {})).status).toBe(401);
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN);
  });

  it('refuses a real client with the wrong token, before anything is opened', async () => {
    const { url, contexts } = await serving();
    await expect(clientOf(url, 'first', { authorization: 'Bearer not-it' })).rejects.toThrow(
      'a token is required',
    );
    expect(contexts).toEqual([]);
  });

  it('refuses a web page: a wrong Origin with the right token, on every path', async () => {
    const { url, log } = await serving();
    for (const origin of ['http://evil.example', 'http://evil.example:8765', 'null']) {
      const r = await post(url, { ...bearer, origin });
      expect(r.status).toBe(403);
      expect(await r.text()).toContain(origin);
    }
    expect((await fetch(url, { headers: { origin: 'http://evil.example' } })).status).toBe(403);
    expect(log).toHaveBeenCalledWith({ http: 'refused', status: 403, origin: 'null' });
  });

  it('takes its own origin, and none, as a client that is no browser sends none', async () => {
    const { url } = await serving();
    const init = '{"jsonrpc":"2.0","method":"nothing"}';
    expect((await post(url, { ...bearer, origin: new URL(url).origin }, init)).status).not.toBe(
      403,
    );
    expect((await post(url, bearer, init)).status).not.toBe(403);
  });

  it('answers a tunnel, which sends its own name for the host', async () => {
    const { url } = await serving();
    const client = await clientOf(url, 'first', { ...bearer, host: 'phone.example.net' });
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
  });

  it('has nothing but its one path, and no streams of its own', async () => {
    const { url } = await serving();
    expect((await post(new URL('/other', url).href, bearer)).status).toBe(404);
    expect((await fetch(url, { headers: bearer })).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE', headers: bearer })).status).toBe(405);
    expect((await post(url, bearer, 'not json')).status).toBe(400);
    expect((await post(url, bearer, 'null')).status).toBe(400);
    expect((await post(url, bearer, `"${'x'.repeat(5 * 1024 * 1024)}"`)).status).toBe(400);
  });

  it('listens on this Mac alone', () => {
    expect(listenOn('127.0.0.1:8765')).toEqual({ host: '127.0.0.1', port: 8765 });
    expect(listenOn('localhost:0')).toEqual({ host: 'localhost', port: 0 });
    expect(listenOn('[::1]:8765')).toEqual({ host: '::1', port: 8765 });
    for (const away of ['0.0.0.0:8765', '192.168.1.5:8765', 'phone.local:80', ':8765', '8765'])
      expect(() => listenOn(away)).toThrow('this Mac alone');
    expect(() => listenOn('127.0.0.1:70000')).toThrow('this Mac alone');
  });
});

describe('a client', () => {
  it('lists the tools and calls one through the SDK', async () => {
    const { url } = await serving();
    const client = await clientOf(url);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain('list_devices');
    expect(text(await client.callTool({ name: 'list_devices' }))).toContain('emulator-5580');
  });

  it('reaches it with the token in the path, for a client with no field for a header', async () => {
    const { url } = await serving();
    const client = await clientOf(`${url}/${TOKEN}`, 'first', {});
    expect((await client.listTools()).tools.length).toBeGreaterThan(10);
  });

  it('sees the progress of a call as it goes', async () => {
    const { url } = await serving();
    const client = await clientOf(url);
    const seen: (string | undefined)[] = [];
    await client.callTool({ name: 'device_info' }, undefined, {
      onprogress: (p) => seen.push(p.message),
    });
    expect(seen).toContain('connecting to emulator-5580');
  });

  it('cancels a running call, by a POST of its own', async () => {
    const { url, log, device } = await serving();
    const client = await clientOf(url);
    const stop = new AbortController();
    const call = client.callTool(
      { name: 'wait_for', arguments: { text: 'never', timeoutMs: 10_000 } },
      undefined,
      { signal: stop.signal },
    );
    await vi.waitFor(() => expect(device.calls.length).toBeGreaterThan(0));
    stop.abort();
    await expect(call).rejects.toThrow();
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'wait_for', outcome: 'refused', code: 'CANCELLED' }),
      ),
    );
  });

  it('stops what it was running when it goes away in the middle', async () => {
    const { url, log, device } = await serving();
    const client = await clientOf(url);
    void client
      .callTool({ name: 'wait_for', arguments: { text: 'never', timeoutMs: 10_000 } })
      .catch(() => undefined);
    await vi.waitFor(() => expect(device.calls.length).toBeGreaterThan(0));
    await client.close();
    await vi.waitFor(() =>
      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({ tool: 'wait_for', code: 'CANCELLED' }),
      ),
    );
  });
});

describe('one client at a time', () => {
  it('keeps the context across the connections of one client, as a hosted one opens one a call', async () => {
    const { url, contexts } = await serving();
    const first = await clientOf(url, 'hosted');
    await first.callTool({ name: 'use_device', arguments: { device: 'emulator-5580' } });
    const second = await clientOf(url, 'hosted');
    expect(text(await second.callTool({ name: 'device_info' }))).toContain('Fake Phone');
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.currentSerial).toBe('emulator-5580');
  });

  it('refuses another client plainly, naming who holds it, and lets the first go on', async () => {
    const { url } = await serving();
    const first = await clientOf(url, 'first');
    await first.callTool({ name: 'list_devices' });
    await expect(clientOf(url, 'second')).rejects.toThrow('first has held it since');
    expect((await first.listTools()).tools.length).toBeGreaterThan(10);
  });

  it('holds nothing for a client that only looked, as a health check does', async () => {
    const { url, contexts } = await serving();
    const check = await clientOf(url, 'check');
    await check.listTools();
    const real = await clientOf(url, 'real');
    await real.callTool({ name: 'list_devices' });
    await expect(clientOf(url, 'check')).rejects.toThrow('real has held it since');
    expect(contexts).toHaveLength(1);
  });
});

describe('when the client has gone', () => {
  it('puts its conditions back and frees the device, and the next client starts clean', async () => {
    const { url, dark, contexts } = await serving(50);
    const first = await clientOf(url, 'first');
    await first.callTool({
      name: 'device_setting',
      arguments: { name: 'dark_mode', value: 'yes' },
    });
    expect(dark.value).toBe('yes');
    expect(contexts[0]!.heldBy('emulator-5580')?.pid).toBe(process.pid);
    await first.close();
    await vi.waitFor(() => expect(dark.value).toBe('no'));
    await vi.waitFor(() => expect(contexts[0]!.heldBy('emulator-5580')).toBeUndefined());

    const second = await clientOf(url, 'second');
    expect((await second.listTools()).tools.length).toBeGreaterThan(10);
    expect(contexts).toHaveLength(2);
  });

  it('does not count a client as gone while a call of its own runs', async () => {
    const { url, dark } = await serving(50);
    const client = await clientOf(url);
    await client.callTool({
      name: 'device_setting',
      arguments: { name: 'dark_mode', value: 'yes' },
    });
    await client.callTool({ name: 'wait_for', arguments: { text: 'never', timeoutMs: 300 } });
    expect(dark.value).toBe('yes');
  });

  it('holds no call of a stopped server, and ends the seat', async () => {
    const { url, dark, stop } = await serving();
    const client = await clientOf(url);
    await client.callTool({
      name: 'device_setting',
      arguments: { name: 'dark_mode', value: 'yes' },
    });
    await stop();
    expect(dark.value).toBe('no');
    await expect(client.listTools()).rejects.toThrow();
  });
});
