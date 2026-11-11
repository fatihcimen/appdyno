import { compilerCheck, type Check, type DeviceProvider } from '@appdyno/core';

/** What this machine needs: Node, then what each driver asks of it and, with `serial`, of that device. */
export async function doctor(opts: {
  providers: DeviceProvider[];
  serial?: string;
}): Promise<Check[]> {
  const major = Number(process.versions.node.split('.')[0]);
  const checks: Check[] = [
    {
      name: 'node',
      ok: major >= 22,
      detail: process.versions.node,
      ...(major < 22 && {
        fix: 'install Node 22 or newer, from nodejs.org or as you installed this one',
      }),
    },
  ];
  // the app's helpers are built already
  if (!process.env.APPDYNO_HELPERS) checks.push(await compilerCheck());
  // the driver that would open it, as any other has no such device to speak of
  const { serial } = opts;
  const owner =
    serial === undefined ? undefined : opts.providers.findLast((p) => p.handles(serial));
  for (const p of opts.providers)
    if (p.doctor) checks.push(...(await p.doctor(p === owner ? serial : undefined)));
  return checks;
}
