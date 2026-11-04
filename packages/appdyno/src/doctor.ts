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
      ...(major < 22 && { fix: 'install Node 22 or newer (mise use node@22)' }),
    },
  ];
  checks.push(await compilerCheck());
  for (const p of opts.providers) if (p.doctor) checks.push(...(await p.doctor(opts.serial)));
  return checks;
}
