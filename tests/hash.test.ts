import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { sha256Hex, sha256HexFallback } from '../src/lib/hash';

// Стандартные векторы FIPS 180-4: реализации (webcrypto и js-fallback)
// обязаны давать одинаковый результат — от него зависит отметка «эта сессия».
describe('sha256Hex', () => {
  it('matches FIPS 180-4 test vectors', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex('some-refresh-token')).toHaveLength(64);
  });

  it('is deterministic and hex-only', async () => {
    const a = await sha256Hex('refresh-token-1');
    const b = await sha256Hex('refresh-token-1');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

// Фолбэк для сред без WebCrypto сверяем с node:crypto на векторах и случайных
// строках, включая многоблочные (>64 байт) и кириллицу (UTF-8).
describe('sha256HexFallback', () => {
  const cases = ['', 'abc', 'a'.repeat(63), 'b'.repeat(64), 'c'.repeat(65), 'refresh-токен-сессии', 'x'.repeat(1000)];
  it.each(cases)('matches node:crypto for %j-length input', (input) => {
    expect(sha256HexFallback(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
  });

  it('agrees with node:crypto on random inputs', () => {
    for (let i = 0; i < 50; i++) {
      const input = Array.from({ length: 1 + Math.floor(Math.random() * 200) }, () => String.fromCharCode(33 + Math.floor(Math.random() * 90))).join('');
      expect(sha256HexFallback(input)).toBe(createHash('sha256').update(input, 'utf8').digest('hex'));
    }
  });
});
