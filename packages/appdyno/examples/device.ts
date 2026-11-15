import { aim, nameOf, openDevice } from 'appdyno/device';

/** Reads the screen, taps the control its words name at a point of its own, and gives the words of the screen after. */
export async function tapByWords(serial: string, text: string, log: (line: string) => void) {
  const device = await openDevice(serial);
  try {
    const target = aim(await device.screen(), { text });
    const { settled } = await device.tap(target.point, { before: target.on });
    log(`tapped ${nameOf(target.element)} at ${target.point.x},${target.point.y}`);
    if (!settled) log('the screen still moves');
    return (await device.screen()).elements.map((e) => e.label);
  } finally {
    await device.close();
  }
}
