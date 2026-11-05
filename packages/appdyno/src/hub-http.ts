import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stateDir, writeWhole } from '@appdyno/core';

/** The port the guide uses, and how far on to look when that is taken: a tunnel goes wherever the hub says it stands. */
const FIRST_PORT = 8765;
const PORTS = 10;
const START_MS = 30_000;
const STOP_MS = 5_000;
const TAIL = 400;

/** Kept, as a connector saved in a client goes on holding the same one; 0600 like all a device's tokens here. */
const tokenFile = () => join(stateDir(), 'http-token');

const tokenMade = () => randomBytes(32).toString('base64url');

/** The token this Mac's HTTP server takes. */
export function httpToken() {
  try {
    return readFileSync(tokenFile(), 'utf8').trim();
  } catch {
    return renewHttpToken();
  }
}

/** For a token that got out: the one kept goes, and so does every connector that holds it. */
export function renewHttpToken() {
  const token = tokenMade();
  writeWhole(tokenFile(), token);
  return token;
}

/**
 * `appdyno mcp --http`, started and stopped from the hub, in a process of its own: a call it serves is no call in the
 * hub's, whose window streams the same device. The token goes in its environment, as a flag would show in `ps`, and
 * it ends with the hub, however the hub ends: a server left open is a way in that nobody is watching.
 */
export class HubHttp {
  private child?: ChildProcess;
  private url?: string;

  constructor(private readonly command: string[]) {}

  get address() {
    return this.url;
  }

  private tryPort(port: number) {
    return new Promise<'taken' | string>((resolve, reject) => {
      const [program, ...args] = this.command;
      const child = spawn(program!, [...args, '--http', `127.0.0.1:${port}`, '--end-with-parent'], {
        stdio: ['pipe', 'ignore', 'pipe'],
        env: { ...process.env, APPDYNO_HTTP_TOKEN: httpToken() },
      });
      let said = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('the server did not start in time'));
      }, START_MS);
      child.stderr.on('data', (chunk: Buffer) => {
        said = (said + chunk.toString()).slice(-TAIL);
        const address = /appdyno mcp: (http\S+)/.exec(said)?.[1];
        if (!address) return;
        clearTimeout(timer);
        this.child = child;
        child.once('exit', () => {
          if (this.child === child) this.forget();
        });
        resolve(address);
      });
      child.once('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.once('exit', () => {
        clearTimeout(timer);
        if (/EADDRINUSE/.test(said)) resolve('taken');
        else reject(new Error(said.trim() || 'the server stopped as it started'));
      });
    });
  }

  private forget() {
    this.child = undefined;
    this.url = undefined;
  }

  async start() {
    if (this.child) return;
    for (let port = FIRST_PORT; port < FIRST_PORT + PORTS; port++) {
      const got = await this.tryPort(port);
      if (got === 'taken') continue;
      this.url = got;
      return;
    }
    throw new Error(`no port free from ${FIRST_PORT} to ${FIRST_PORT + PORTS - 1}`);
  }

  async stop() {
    const child = this.child;
    if (!child) return;
    this.forget();
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, STOP_MS);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      child.kill('SIGTERM');
    });
  }
}
