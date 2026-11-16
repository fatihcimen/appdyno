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

  it('refuses a command whose turn has not come in its time, unsent, and runs none of it when the turn comes', async () => {
    const q = new DeviceQueue();
    let end = (): void => undefined;
    const first = q.run(() => new Promise<void>((done) => (end = done)));
    const ran: string[] = [];
    const late = q.run(() => Promise.resolve(ran.push('late')), 20);
    await expect(late).rejects.toMatchObject({
      code: 'TIMEOUT',
      unsent: true,
      message:
        'waited 0 s for its turn behind an earlier command on this device, which has not ended',
    });
    // it still holds its place: the queue is busy until the first ends, and the next runs after both
    expect(q.busy).toBe(true);
    const next = q.run(() => Promise.resolve(ran.push('next')));
    end();
    await first;
    await next;
    expect(ran).toEqual(['next']);
    expect(q.busy).toBe(false);
  });

  it('holds no timer once its turn came, however long the command then runs', async () => {
    const q = new DeviceQueue();
    await expect(
      q.run(() => new Promise((done) => setTimeout(() => done('slow'), 40)), 10),
    ).resolves.toBe('slow');
  });
});
