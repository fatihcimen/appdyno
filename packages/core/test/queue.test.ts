import { describe, expect, it } from 'vitest';
import { DeviceQueue } from '../src/queue.js';

describe('device queue', () => {
  it('runs commands one after the other, a failure does not block the next', async () => {
    const q = new DeviceQueue();
    const order: string[] = [];
    const slow = q.run(async () => {
      order.push('a start');
      await new Promise((r) => setTimeout(r, 20));
      order.push('a end');
      throw new Error('boom');
    });
    const fast = q.run(() => {
      order.push('b');
      return Promise.resolve(2);
    });
    await expect(slow).rejects.toThrow('boom');
    expect(await fast).toBe(2);
    expect(order).toEqual(['a start', 'a end', 'b']);
  });
});
