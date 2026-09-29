import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { Releases } from '../src/screens/Releases';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { setSession } from '../src/api/session';
import { addFiles, addToDraft, publishDraft, removeFromQueue, resetDraft, setDraftCover, updateDraft, useReleases } from '../src/state/releases';
import type { AudioMeta } from '../src/lib/metadata';
vi.mock('../src/lib/metadata', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/lib/metadata')>();
  return { ...original, probeAudio: async (file: File) => ({ title: file.name, titleFromTags: true, artist: 'Artist', album: 'Album', year: '', trackNo: null, discNo: null, durationMs: 1000, codec: 'MP3', bits: null, sampleRate: null, explicit: false, explicitSource: null }) as AudioMeta };
});
const server = setupServer();
const calls: string[] = [];
let failCover = false;
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); setSession(null); vi.unstubAllGlobals(); });
beforeEach(() => {
  resetDraft();
  const { result, unmount } = renderHook(() => useReleases());
  for (const q of result.current.queue) removeFromQueue(q.id);
  unmount();
  setSession({ userUuid: 'u', userName: 'u', birthDate: '1990-01-01', accessToken: 'access', refreshToken: 'refresh' });
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: () => 'blob:cover', revokeObjectURL: () => {} }));
  calls.length = 0; failCover = false;
  server.use(
    http.get('*/catalog/artists/search', () => { calls.push('search'); return HttpResponse.json([]); }),
    http.post('*/catalog/artists', () => { calls.push('artist'); return HttpResponse.json({ artist_uuid: 'artist' }); }),
    http.post('*/catalog/albums', () => { calls.push('album'); return HttpResponse.json({ album_uuid: 'album' }); }),
    http.get('*/catalog/albums/album', () => { calls.push('album-check'); return HttpResponse.json({ album_uuid: 'album' }); }),
    http.post('*/catalog/tracks', () => { calls.push('track'); return HttpResponse.json({ track_uuid: 'track' }); }),
    http.get('*/catalog/tracks/track/exists', () => HttpResponse.json({ exists: true })),
    http.post('*/catalog/tracks/track/file', () => { calls.push('file'); return HttpResponse.json({}); }),
    http.post('*/catalog/albums/album/cover', () => { calls.push('cover'); return failCover ? new HttpResponse('cover failed', { status: 500 }) : HttpResponse.json({}); }),
    http.post('*/catalog/albums/album/tracks', async ({ request }) => { calls.push('positions'); expect(await request.json()).toEqual({ tracks: [{ track_uuid: 'track', position: 1 }] }); return HttpResponse.json({}); }),
  );
});
async function prepare(names = ['one.mp3']) {
  const { result } = renderHook(() => useReleases());
  act(() => { addFiles(names.map((name) => new File(['audio'], name, { type: 'audio/mpeg' }))); });
  await waitFor(() => expect(result.current.queue).toHaveLength(names.length));
  await waitFor(() => expect(result.current.queue.every((q) => q.stage === 'READY')).toBe(true));
  act(() => { addToDraft(); updateDraft({ title: 'Album', artist: 'Artist' }); setDraftCover(new File(['image'], 'cover.png', { type: 'image/png' })); });
  return result;
}
it('publishes artist, album, track, file, cover, then positions', async () => {
  const state = await prepare();
  await act(async () => { await publishDraft(); });
  expect(calls).toEqual(['search', 'artist', 'album', 'track', 'file', 'cover', 'positions']);
  expect(state.current.draft.tracks).toHaveLength(0);
});
it('keeps created ids and uploaded track resumable after a cover failure', async () => {
  const state = await prepare(); failCover = true;
  await act(async () => { await expect(publishDraft()).rejects.toThrow(); });
  expect(state.current.draft.albumUuid).toBe('album');
  expect(state.current.draft.tracks[0]).toMatchObject({ trackUuid: 'track', uploaded: true });
  expect(state.current.draft.error).toContain('cover failed');
  expect(calls).not.toContain('positions');
  failCover = false; calls.length = 0;
  await act(async () => { await publishDraft(); });
  expect(calls).toEqual(['album-check', 'cover', 'positions']);
});

it('renders a failed created draft as locked against reorder and composition', async () => {
  await prepare(); failCover = true;
  await act(async () => { await expect(publishDraft()).rejects.toThrow(); });
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><MemoryRouter><Releases /></MemoryRouter></QueryClientProvider>);
  expect(screen.getByRole('button', { name: 'Нет готовых файлов' })).toBeDisabled();
  expect(screen.getByTitle('Вернуть в очередь')).toBeDisabled();
  expect(document.querySelector('.d-row')).toHaveAttribute('draggable', 'false');
});
it('records a per-track upload error and retries its file without recreating the track', async () => {
  const state = await prepare();
  server.use(http.post('*/catalog/tracks/track/file', () => new HttpResponse('disk full', { status: 507 })));
  await act(async () => { await expect(publishDraft()).rejects.toThrow(); });
  expect(state.current.draft.tracks[0]).toMatchObject({ trackUuid: 'track', phase: 'error', error: '507 · disk full' });
  expect(calls).not.toContain('cover');
  server.use(http.post('*/catalog/tracks/track/file', () => { calls.push('file-retry'); return HttpResponse.json({}); }));
  calls.length = 0;
  await act(async () => { await publishDraft(); });
  expect(calls).toEqual(['album-check', 'file-retry', 'cover', 'positions']);
});

function useTwoTrackHandlers() {
  server.use(
    http.post('*/catalog/tracks', async ({ request }) => {
      const body = await request.json() as { track_name: string };
      const name = body.track_name.split('.')[0];
      calls.push(`track:${name}`);
      return HttpResponse.json({ track_uuid: name });
    }),
    http.get('*/catalog/tracks/:id/exists', ({ params }) => {
      calls.push(`exists:${params.id}`);
      return HttpResponse.json({ exists: true });
    }),
    http.post('*/catalog/tracks/:id/file', ({ params }) => {
      calls.push(`file:${params.id}`);
      return HttpResponse.json({});
    }),
    http.post('*/catalog/albums/album/tracks', async ({ request }) => {
      calls.push('positions');
      expect(await request.json()).toEqual({ tracks: [
        { track_uuid: 'one', position: 1 },
        { track_uuid: 'two', position: 2 },
      ] });
      return HttpResponse.json({});
    }),
  );
}

it('publishes both tracks and files in draft order before cover and positions', async () => {
  useTwoTrackHandlers();
  const state = await prepare(['one.mp3', 'two.mp3']);
  await act(async () => { await publishDraft(); });
  expect(calls).toEqual([
    'search', 'artist', 'album',
    'track:one', 'file:one', 'track:two', 'file:two',
    'cover', 'positions',
  ]);
  expect(state.current.draft.tracks).toHaveLength(0);
});

it('keeps the first uploaded track intact when the second file fails, then resumes only the second upload', async () => {
  useTwoTrackHandlers();
  const state = await prepare(['one.mp3', 'two.mp3']);
  server.use(http.post('*/catalog/tracks/two/file', () => {
    calls.push('file:two-failed');
    return new HttpResponse('disk full', { status: 507 });
  }));
  await act(async () => { await expect(publishDraft()).rejects.toThrow('disk full'); });
  expect(calls).toEqual([
    'search', 'artist', 'album',
    'track:one', 'file:one', 'track:two', 'file:two-failed',
  ]);
  expect(state.current.draft.tracks[0]).toMatchObject({ trackUuid: 'one', uploaded: true, phase: 'uploaded' });
  expect(state.current.draft.tracks[1]).toMatchObject({ trackUuid: 'two', phase: 'error', error: '507 · disk full' });
  expect(state.current.draft.albumUuid).toBe('album');
  expect(state.current.draft.publishing).toBe(false);
  server.use(http.post('*/catalog/tracks/two/file', () => {
    calls.push('file:two-retry');
    return HttpResponse.json({});
  }));
  calls.length = 0;
  await act(async () => { await publishDraft(); });
  expect(calls).toEqual([
    'album-check', 'exists:one', 'exists:two', 'file:two-retry', 'cover', 'positions',
  ]);
  expect(state.current.draft.tracks).toHaveLength(0);
});
