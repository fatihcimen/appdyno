/** What a window offers on Android, in the viewer's names. */
const ANDROID_CONTROLS = [
  'back',
  'home',
  'appSwitch',
  'lock',
  'volumeUp',
  'volumeDown',
  'quickSettings',
  'notifications',
  'rotateLeft',
  'rotateRight',
];

/** Where makers keep what they sell a phone as; a Pixel's model is that already. */
const SOLD_AS = [
  'ro.product.marketname',
  'ro.product.vendor.marketname',
  'ro.config.marketing_name',
  'ro.vendor.oplus.market.name',
  'ro.vivo.market.name',
];

type Read = (command: string) => Promise<string>;

/** What a phone is sold as, where it says: a model is often a part number. */
async function soldAs(read: Read) {
  const props = SOLD_AS.map((p) => `getprop ${p}`).join('; ');
  const said = (await read(props)).split('\n').find((l) => l.trim());
  if (said) return said.trim();
  const own = await read('settings get global device_name');
  return own === 'null' ? '' : own;
}

/** What a device is, for how a window draws it, from what it says of itself. */
export async function androidHardware(read: Read, virtual: boolean) {
  const model = await read('getprop ro.product.model');
  const name = virtual ? 'Android emulator' : await soldAs(read);
  return {
    platform: 'android' as const,
    controls: ANDROID_CONTROLS,
    ...(model && { model }),
    ...(name && { name }),
  };
}
