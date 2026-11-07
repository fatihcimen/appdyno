import { needBeside, step, type PhoneLook, type PhoneSteps } from '@appdyno/core';

/** An Android's steps: a phone a driver hears of, or one on the USB bus that adb has not heard of. */
export function androidGuide({ phone, usb, has }: PhoneLook): PhoneSteps | undefined {
  const ours = usb.find((u) => u.maker !== 'apple');
  if (!phone && !ours) return undefined;
  const maker = ours?.maker ?? 'other';
  const heard = phone !== undefined;
  const { input = '', install = '' } = phone?.switches ?? {};
  return {
    maker,
    hand: 'android',
    steps: [
      ...(has('adb') ? [] : [step('get-adb', false)]),
      // from a Mac these two are one state: adb has not heard of the phone
      step('developer-options', heard, false),
      step('usb-debugging', heard, false),
      step('allow', phone?.state === 'device'),
      // a phone of another maker has no such switches, and says so by reading nothing
      ...(maker === 'xiaomi' || input || install
        ? [
            step('xiaomi-security', input === '1', false),
            step('xiaomi-install', install === '1', false),
          ]
        : []),
    ],
    ...needBeside(phone?.need, ['not-trusted']),
    ...(phone?.state === 'device' &&
      phone.link === 'USB' && {
        wifi: { way: 'code', paired: phone.onWifi === true },
      }),
  };
}
