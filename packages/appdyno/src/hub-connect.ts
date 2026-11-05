import type { Check, DeviceProvider, ListedPhone, PhoneLook, PhoneSteps } from '@appdyno/core';

export type Guide = Partial<PhoneSteps> & {
  steps: PhoneSteps['steps'];
  /** The kind of phone in a person's hand: nothing else is asked of them. */
  hand?: string;
  /** Nothing but a person's word is left. */
  ready: boolean;
  serial?: string;
  name?: string;
};

/** The phone's one current step, from what the Mac can read of it. Pure, for each state a phone can stand in. */
export function guideFor(
  providers: DeviceProvider[],
  o: { usb: PhoneLook['usb']; phones: ListedPhone[]; has: PhoneLook['has'] },
): Guide {
  const phone = o.phones.find((p) => p.need || !p.ready) ?? o.phones[0];
  const owner = phone && providers.findLast((p) => p.handles(phone.serial));
  for (const provider of owner ? [owner] : providers) {
    const made = provider.guide?.({ ...o, ...(phone && { phone }) });
    if (!made) continue;
    const name = phone?.model ?? o.usb[0]?.name;
    return {
      ...made,
      ...(provider.virtual && { hand: provider.virtual.platform }),
      ready: !made.need && made.steps.every((s) => s.done || !s.sees),
      ...(phone && { serial: phone.serial }),
      ...(name && { name }),
    };
  }
  return { steps: [], ready: false };
}

/** Phones only: a simulator or an emulator needs none of this. */
const isPhone = (d: { serial: string; state: string }) =>
  d.state !== 'booted' && !d.serial.startsWith('emulator-');

/** Each phone a driver hears of, with what stands in its way. */
export async function listedPhones(
  providers: DeviceProvider[],
  switches: (serial: string) => Promise<ListedPhone['switches']>,
): Promise<ListedPhone[]> {
  const listed = await Promise.all(providers.map((p) => p.list().catch(() => [])));
  return Promise.all(
    listed
      .flat()
      .filter(isPhone)
      .map(async (d) => {
        const provider = providers.findLast((p) => p.handles(d.serial));
        const need = await provider?.need?.(d).catch(() => undefined);
        const own =
          d.state === 'device' ? await switches(d.serial).catch(() => undefined) : undefined;
        return { ...d, ...(need && { need }), ...(own && { switches: own }) };
      }),
  );
}

/** What a phone's runner asks of this Mac, as `doctor` says it: only for one who wants a runner. */
export const runnerChecks = (checks: Check[]) =>
  checks.filter((c) => /^(xcode$|ios runner \(iPhone\)|iPhone )/.test(c.name));
