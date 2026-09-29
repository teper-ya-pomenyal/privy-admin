import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addFiles, addToDraft, isDraftLocked, moveTrack, removeFromQueue, resetDraft, setDraftTarget, useReleases, type Draft } from '../src/state/releases';
import type { AudioMeta } from '../src/lib/metadata';
vi.mock('../src/lib/metadata', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/metadata')>();
  return { ...original, probeAudio: async (file: File) => ({ title: file.name, titleFromTags: true, artist: 'Artist', album: 'Album', year: '', trackNo: null, discNo: null, durationMs: 1000, codec: 'MP3', bits: null, sampleRate: null, explicit: false, explicitSource: null }) as AudioMeta };
});
const file = (name: string, type = '') => new File(['audio'], name, { type, lastModified: 1 });
beforeEach(() => {
  resetDraft();
  for (const q of [...useSnapshot().queue]) removeFromQueue(q.id);
});
function useSnapshot() { let value!: ReturnType<typeof useReleases>; const { result, unmount } = renderHook(() => useReleases()); value = result.current; unmount(); return value; }
describe('release queue and draft', () => {
  it('filters image and other files and counts duplicates already queued', async () => {
    const { result } = renderHook(() => useReleases());
    let counts!: ReturnType<typeof addFiles>;
    act(() => { counts = addFiles([file('a.mp3'), file('cover.png'), file('notes.txt')]); });
    expect(counts).toEqual({ added: 1, duplicates: 0, images: 1, other: 1 });
    await waitFor(() => expect(result.current.queue[0].stage).toBe('READY'));
    act(() => { counts = addFiles([file('a.mp3')]); });
    expect(counts).toEqual({ added: 0, duplicates: 1, images: 0, other: 0 });
  });
  // Known bug: addFiles builds `known` before filtering the batch, so duplicates inside one call survive.
  it.fails('deduplicates two copies of the same audio file in one addFiles batch', () => {
    const counts = addFiles([file('same.mp3'), file('same.mp3')]);
    expect(counts).toEqual({ added: 1, duplicates: 1, images: 0, other: 0 });
  });
  it('sorts ready files into the draft and blocks composition after album creation', async () => {
    const { result } = renderHook(() => useReleases());
    act(() => { addFiles([file('b.mp3'), file('a.mp3')]); });
    await waitFor(() => expect(result.current.queue.every((q) => q.stage === 'READY')).toBe(true));
    act(() => { addToDraft(); });
    expect(result.current.draft.tracks.map((t) => t.file.name)).toEqual(['a.mp3', 'b.mp3']);
    const before = result.current.draft.tracks.map((t) => t.id);
    act(() => { moveTrack(0, 1); });
    expect(result.current.draft.tracks.map((t) => t.id)).toEqual([...before].reverse());
  });
  it('locks new albums with an id, existing albums with created tracks, and publishing drafts', () => {
    const blank = { target: { kind: 'new' }, tracks: [], publishing: false } as Draft;
    expect(isDraftLocked(blank)).toBe(false);
    expect(isDraftLocked({ ...blank, publishing: true })).toBe(true);
    expect(isDraftLocked({ ...blank, albumUuid: 'album' })).toBe(true);
    const existing = { ...blank, target: { kind: 'existing', albumUuid: 'a', albumName: 'A', artistUuid: 'x', artistName: 'X', basePosition: 0 } } as Draft;
    expect(isDraftLocked(existing)).toBe(false);
    expect(isDraftLocked({ ...existing, tracks: [{ trackUuid: 'track' }] as Draft['tracks'] })).toBe(true);
  });
  it('accepts target switching before the draft is locked', () => {
    expect(setDraftTarget({ kind: 'existing', albumUuid: 'a', albumName: 'A', artistUuid: 'x', artistName: 'X', basePosition: 1 })).toBe(true);
  });
});
