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
  const drivers: Check[][] = [];
  for (const p of opts.providers)
    if (p.doctor) drivers.push(await p.doctor(p === owner ? serial : undefined));
  checks.push(...drivers.flat());
  // each driver lacks what it cannot drive a device without: this machine drives none
  if (drivers.length > 0 && drivers.every((d) => d.some((c) => c.blocks && !c.ok)))
    checks.push({
      name: 'devices',
      ok: false,
      detail: 'no platform can be driven here',
      fix: 'install what a warning above names, for the platform you test',
    });
  return checks;
}
