import { xmlText, must } from '@appdyno/core';
import { DeviceError } from '@appdyno/protocol';
import { dsymBinaries, named } from './symbols.js';
import { parseTimeProfile } from './trace-parse.js';

/** What `atos` takes on one command line. */
const ADDRESSES_A_CALL = 400;

/** A frame of this binary with an address for a name; the binary is written out once, then by `ref`. */
const framesOf = (binary: string) =>
  new RegExp(
    `<frame id="\\d+" name="(0x[0-9a-f]+)" addr="(0x[0-9a-f]+)"[^>]*>\\s*<binary (?:id|ref)="${binary}"`,
    'g',
  );

/** A function without the line in it: a line each would split its time, and tell two builds apart for no reason. */
export const functionOf = (name: string) => name.replace(/ \([^()]+:\d+\)$/, '');

/** The trace's XML with these addresses of this binary as their names. */
export function renamed(xml: string, binary: string, names: Map<string, string>) {
  return xml.replace(framesOf(binary), (frame, name: string, addr: string) => {
    const symbol = names.get(addr);
    return symbol ? frame.replace(`name="${name}"`, `name="${xmlText(symbol)}"`) : frame;
  });
}

/**
 * A Time Profiler's table with the names a build's dSYMs have for its frames. `xctrace symbolicate` answered "No dSYMs
 * were found or relevant" for a phone's trace and the dSYM of the very build in it, UUID for UUID, given the bundle, its
 * folder or the DWARF file. The export has each frame's address and the binary's load address, which is all `atos` needs.
 */
export async function nameFrames(xml: string, dsym: string): Promise<string> {
  const inTrace = (await dsymBinaries(dsym)).flatMap((binary) => {
    const m = new RegExp(
      `<binary id="(\\d+)"[^>]*UUID="${binary.uuid}"[^>]*load-addr="(0x[0-9a-f]+)"`,
      'i',
    ).exec(xml);
    return m ? [{ binary, id: must(m[1], 'a binary id'), base: Number(m[2]) }] : [];
  });
  if (inTrace.length === 0)
    throw new DeviceError(
      'NOT_FOUND',
      `${dsym} is of no build in this trace: it would name nothing, or the wrong thing`,
      'give the dSYM of the build that ran',
    );
  let out = xml;
  for (const { binary, id, base } of inTrace) {
    const addrs = [
      ...new Set([...xml.matchAll(framesOf(id))].map((m) => must(m[2], 'an address'))),
    ];
    const names = new Map<string, string>();
    for (let i = 0; i < addrs.length; i += ADDRESSES_A_CALL) {
      const part = addrs.slice(i, i + ADDRESSES_A_CALL);
      const got = await named(
        binary,
        base,
        part.map((a) => Number(a) - base),
      );
      part.forEach((a, n) => got[n] && names.set(a, functionOf(got[n])));
    }
    out = renamed(out, id, names);
  }
  return out;
}

/** Of one process: one that only slept ran none of its own code, which leaves nothing to name and is no wrong dSYM. */
export const nameFramesOf = async (xml: string, pid: number, dsym: string) =>
  parseTimeProfile(xml, pid).appTop.length ? nameFrames(xml, dsym) : xml;
