import { describe, expect, it, vi } from 'vitest';
import { iphoneProvider } from '../src/phone-provider.js';

const made: unknown[][] = [];

vi.mock('../src/phone.js', () => ({
  IosPhoneDevice: vi.fn(function (...given: unknown[]) {
    made.push(given);
  }),
}));

describe('the signing an iPhone provider is given', () => {
  it('signs the runner of each phone it opens, and none where it was given none', () => {
    const phone = '00001234-0123456789ABCDEF';
    const signing = { profile: '/p/one.mobileprovision', keychain: 'ci.keychain' };
    iphoneProvider(undefined, signing).open(phone);
    iphoneProvider().open(phone);
    expect(made).toEqual([
      [phone, signing],
      [phone, undefined],
    ]);
  });
});
