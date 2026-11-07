import { needBeside, step, type PhoneLook, type PhoneSteps } from '@appdyno/core';
import { pairedPhones } from './wifi-paired.js';

/** An iPhone's steps: one a driver hears of, or one on the USB bus it has not. */
export function iphoneGuide({ phone, usb, has }: PhoneLook): PhoneSteps | undefined {
  if (!phone && !usb.some((u) => u.maker === 'apple')) return undefined;
  const trusted =
    phone !== undefined && !['not-connected', 'not-trusted'].includes(phone.need ?? '');
  return {
    maker: 'apple',
    hand: 'ios',
    steps: [
      ...(has('xcode') ? [] : [step('get-xcode', false)]),
      step('trust', trusted),
      step('developer-mode', trusted && phone.need !== 'developer-mode-off'),
    ],
    ...needBeside(phone?.need, ['not-connected', 'not-trusted', 'developer-mode-off']),
    ...(trusted &&
      phone.link === 'USB' && {
        wifi: { way: 'cable', paired: pairedPhones().includes(phone.serial) },
      }),
  };
}
