import { describe, expect, it } from 'vitest';
import { phonesIn } from '../src/usb.js';

const block = (
  name: string,
  vendor: number,
  location: number,
) => `+-o ${name}@1  <class IOUSBHostDevice>
    {
      "idVendor" = ${vendor}
      "USB Product Name" = "${name}"
      "locationID" = ${location}
    }
`;

describe('phones on a USB bus', () => {
  it('finds a phone by who made it, and who makes a Samsung or a Xiaomi matters', () => {
    expect(phonesIn(block('SM-S928B', 0x04e8, 1) + block('2312DRA50G', 0x2717, 2))).toEqual([
      { maker: 'samsung', name: 'SM-S928B' },
      { maker: 'xiaomi', name: '2312DRA50G' },
    ]);
  });

  it('takes what is not a phone for nothing: a hub, or a keyboard of the same maker as an iPhone', () => {
    expect(phonesIn(block('USB 2.0 Hub', 6720, 1) + block('Magic Keyboard', 0x05ac, 2))).toEqual(
      [],
    );
    expect(phonesIn(block('iPhone', 0x05ac, 3))).toEqual([{ maker: 'apple', name: 'iPhone' }]);
  });

  it('counts a device once, though it stands under its hub and again by itself', () => {
    expect(phonesIn(block('Pixel 8', 0x18d1, 7) + block('Pixel 8', 0x18d1, 7))).toHaveLength(1);
  });

  it('says nothing of a bus with nothing on it', () => {
    expect(phonesIn('')).toEqual([]);
  });
});
