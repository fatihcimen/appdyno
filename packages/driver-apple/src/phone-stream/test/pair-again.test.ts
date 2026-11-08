import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { assert, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { must } from '@appdyno/core';
import { identityFile } from '../../wifi-paired.js';
import type { Identity } from '../pairing.js';
import { pairAnew, wifiCheck } from '../wifi.js';
import { fakePhones, type FakePhone } from './fake-phone.js';

const { aPhone, open } = fakePhones();

const pairedWith = async (phone: FakePhone) =>
  must(await pairAnew(await open(phone), undefined, vi.fn()), 'a pairing');

describe('a pairing asked for again on the cable', () => {
  it('leaves a phone that proves it knows this Mac as it is, and asks no one', async () => {
    const phone = await aPhone();
    const known = await pairedWith(phone);
    const asked = vi.fn();
    await expect(pairAnew(await open(phone), known, asked)).resolves.toBeUndefined();
    expect(asked).not.toHaveBeenCalled();
  });

  it('pairs a phone that forgot this Mac anew, with a person asked', async () => {
    const phone = await aPhone();
    const known = await pairedWith(phone);
    phone.known.clear();
    const asked = vi.fn();
    const made = await pairAnew(await open(phone), known, asked);
    expect(asked).toHaveBeenCalledOnce();
    assert(made);
    expect(made.host).not.toBe(known.host);
    expect(phone.known.has(made.host)).toBe(true);
  });

  it('pairs anew where what is kept is of another key, as an erased phone has', async () => {
    const phone = await aPhone();
    const other: Identity = await pairedWith(await aPhone());
    const made = await pairAnew(await open(phone), other, vi.fn());
    assert(made);
    expect(phone.known.has(made.host)).toBe(true);
  });
});

describe('a pairing cut short on this Mac', () => {
  const was = process.env.APPDYNO_STATE_DIR;
  let state: string;
  beforeEach(() => {
    state = mkdtempSync(join(tmpdir(), 'appdyno-pair-'));
    process.env.APPDYNO_STATE_DIR = state;
  });
  afterEach(() => {
    process.env.APPDYNO_STATE_DIR = was;
    rmSync(state, { recursive: true, force: true });
  });

  it('is a need a person can meet, not a failure to read', async () => {
    const file = identityFile('00000000-0000000000000001');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{"host": "cut sh');
    await expect(wifiCheck('00000000-0000000000000001')).resolves.toMatchObject({
      ok: false,
      need: 'not-paired',
    });
  });
});
