import { describe, expect, it } from 'vitest';
import { audioQuality, extOf, isAudio, isImage, type AudioMeta } from '../src/lib/metadata';
const file = (name: string, type = '') => new File(['x'], name, { type });
describe('file classification and quality', () => {
  it('normalizes extensions and accepts known audio and image extensions', () => {
    expect(extOf('SONG.FLAC')).toBe('flac');
    expect(isAudio(file('SONG.FLAC'))).toBe(true);
    expect(isAudio(file('unknown.bin', 'audio/ogg'))).toBe(true);
    expect(isImage(file('COVER.JPEG'))).toBe(true);
    expect(isImage(file('unknown.bin', 'image/png'))).toBe(true);
    expect(isAudio(file('notes.txt'))).toBe(false);
  });
  it('formats bit depth and sample rate, with sample-only fallback', () => {
    const meta = { bits: 24, sampleRate: 96000 } as AudioMeta;
    expect(audioQuality(meta)).toBe('24/96');
    expect(audioQuality({ ...meta, bits: null })).toBe('96 kHz');
    expect(audioQuality({ ...meta, sampleRate: null })).toBe('');
  });
});
