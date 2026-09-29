import { expect, it } from 'vitest';
import { mapPool } from '../src/lib/pool';
it('limits work to two concurrent operations while preserving result order', async () => {
  let running = 0, peak = 0;
  const values = await mapPool([1, 2, 3, 4, 5], 2, async (n) => {
    peak = Math.max(peak, ++running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return n * 2;
  });
  expect(peak).toBe(2);
  expect(values).toEqual([2, 4, 6, 8, 10]);
});
it('allows another in-flight worker to finish after one fails', async () => {
  const completed: number[] = [];
  await expect(mapPool([1, 2], 2, async (n) => {
    if (n === 1) { await new Promise((r) => setTimeout(r, 5)); throw Error('bad'); }
    await new Promise((r) => setTimeout(r, 1)); completed.push(n); return n;
  })).rejects.toThrow('bad');
  expect(completed).toEqual([2]);
});
