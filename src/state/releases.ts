import { useSyncExternalStore } from 'react';
import { catalog } from '../api/endpoints';
import { ApiError, errorLabel } from '../api/http';

import { audioQuality, isAudio, isImage, probeAudio, type AudioMeta } from '../lib/metadata';
import { mapPool } from '../lib/pool';

// Загрузка релиза поверх API v1. Контракт не даёт серверной очереди индексации,
// поэтому файлы разбираются в браузере (ffprobe/теги → music-metadata), а
// публикация — это цепочка вызовов Gateway:
//   AddArtist (или поиск существующего) → AddAlbum → [AddTrack → POST /tracks/{id}/file]×N → AddTracksToAlbum
// Состояние живёт в памяти вкладки: File нельзя сохранить между перезагрузками.

export type QueueStage = 'PROBE' | 'READY' | 'ERROR';

export interface QueueItem {
  id: string;
  file: File;
  stage: QueueStage;
  meta?: AudioMeta;
  error?: string;
}

export type TrackPhase = 'idle' | 'index' | 'upload' | 'uploaded' | 'done' | 'error';

export interface DraftTrack {
  id: string;
  file: File;
  meta: AudioMeta;
  title: string;
  explicit: boolean;
  trackUuid?: string;
  uploaded?: boolean;
  progress: number;
  phase: TrackPhase;
  error?: string;
}

export type DraftTarget =
  | { kind: 'new' }
  | { kind: 'existing'; albumUuid: string; albumName: string; artistUuid: string; artistName: string; basePosition: number };

export interface Draft {
  target: DraftTarget;
  title: string;
  artist: string;
  tracks: DraftTrack[];
  artistUuid?: string;
  /** Имя артиста, на карточку которого указывает artistUuid (выбор из подсказок). */
  artistName?: string;
  albumUuid?: string;
  /** Обложка уезжает на узел в конце публикации (POST /catalog/albums/{id}/cover). */
  cover?: File;
  coverUrl?: string;
  /** Прогресс и статус загрузки обложки внутри публикации. */
  coverUploaded?: boolean;
  coverProgress?: number;
  publishing: boolean;
  error?: string;
}

export interface ReleasesState {
  queue: QueueItem[];
  draft: Draft;
}

const emptyDraft = (): Draft => ({ target: { kind: 'new' }, title: '', artist: '', tracks: [], publishing: false });

let state: ReleasesState = { queue: [], draft: emptyDraft() };
const listeners = new Set<() => void>();
let seq = 0;

function set(fn: (s: ReleasesState) => ReleasesState) {
  state = fn(state);
  listeners.forEach((l) => l());
}
const setDraft = (fn: (d: Draft) => Draft) => set((s) => ({ ...s, draft: fn(s.draft) }));
const patchTrack = (id: string, patch: Partial<DraftTrack>) =>
  setDraft((d) => ({ ...d, tracks: d.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
const patchQueue = (id: string, patch: Partial<QueueItem>) =>
  set((s) => ({ ...s, queue: s.queue.map((q) => (q.id === id ? { ...q, ...patch } : q)) }));

export function useReleases() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Альбом уже создан на сервере — структуру черновика (порядок, состав) менять нельзя. */
export const isDraftLocked = (d: Draft) => d.publishing || !!(d.target.kind === 'new' ? d.albumUuid : d.tracks.some((t) => t.trackUuid));

// ---------- очередь ----------

async function probe(item: QueueItem) {
  patchQueue(item.id, { stage: 'PROBE', error: undefined });
  try {
    const meta = await probeAudio(item.file);
    if (!meta.durationMs) throw new Error('не удалось определить длительность');
    patchQueue(item.id, { stage: 'READY', meta });
  } catch (e) {
    patchQueue(item.id, { stage: 'ERROR', error: errorLabel(e) || 'файл не читается' });
  }
}

export function addFiles(files: File[]) {
  const audio = files.filter(isAudio);
  const images = files.filter((f) => !isAudio(f) && isImage(f)).length;
  const other = files.length - audio.length - images;
  const known = new Set([...state.queue.map((q) => q.file), ...state.draft.tracks.map((t) => t.file)].map(fileKey));
  const fresh = audio.filter((f) => !known.has(fileKey(f)));
  const items: QueueItem[] = fresh.map((file) => ({ id: `f${++seq}`, file, stage: 'PROBE' }));
  set((s) => ({ ...s, queue: [...s.queue, ...items] }));
  void mapPool(items, 2, probe);
  return { added: items.length, duplicates: audio.length - fresh.length, images, other };
}

const fileKey = (f: File) => `${f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`;

export function retryProbe(id: string) {
  const item = state.queue.find((q) => q.id === id);
  if (item) void probe(item);
}

export function removeFromQueue(id: string) {
  set((s) => ({ ...s, queue: s.queue.filter((q) => q.id !== id) }));
}

// ---------- черновик ----------

const byTrackOrder = (a: QueueItem, b: QueueItem) =>
  (a.meta?.discNo ?? 1) - (b.meta?.discNo ?? 1) ||
  (a.meta?.trackNo ?? 9999) - (b.meta?.trackNo ?? 9999) ||
  a.file.name.localeCompare(b.file.name, 'ru', { numeric: true });

export function addToDraft(ids?: string[]) {
  if (isDraftLocked(state.draft)) return 0;
  const picked = state.queue.filter((q) => q.stage === 'READY' && (!ids || ids.includes(q.id))).sort(byTrackOrder);
  if (!picked.length) return 0;
  const first = picked[0].meta!;
  set((s) => ({
    queue: s.queue.filter((q) => !picked.includes(q)),
    draft: {
      ...s.draft,
      title: s.draft.target.kind === 'new' && !s.draft.title ? first.album || first.title : s.draft.title,
      artist: s.draft.target.kind === 'new' && !s.draft.artist ? first.artist : s.draft.artist,
      tracks: [
        ...s.draft.tracks,
        ...picked.map((q) => ({
          id: q.id,
          file: q.file,
          meta: q.meta!,
          // Имя файла в название не подставляем: без тегов владелец вводит его сам.
          title: q.meta!.titleFromTags ? q.meta!.title : '',
          explicit: q.meta!.explicit,
          progress: 0,
          phase: 'idle' as const,
        })),
      ],
    },
  }));
  return picked.length;
}

export function returnToQueue(trackId: string) {
  const t = state.draft.tracks.find((x) => x.id === trackId);
  if (!t || t.trackUuid || state.draft.publishing) return;
  set((s) => ({
    queue: [...s.queue, { id: t.id, file: t.file, stage: 'READY', meta: t.meta }],
    draft: { ...s.draft, tracks: s.draft.tracks.filter((x) => x.id !== trackId) },
  }));
}

export function updateDraft(patch: Partial<Pick<Draft, 'title' | 'artist' | 'artistUuid' | 'artistName'>>) {
  setDraft((d) => ({ ...d, ...patch }));
}

/** Обложка живёт в этой вкладке (превью через object URL), на узел уходит в publishDraft.
    Картинки больше COVER_MAX_SIDE×COVER_MAX_SIDE отклоняет pickCover на экране. */
export const COVER_MAX_SIDE = 3000;

/** Белый список форматов обложек из контракта (POST /cover, сервер отвергает остальное). */
export const COVER_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

export function setDraftCover(file: File | undefined) {
  if (state.draft.publishing) return;
  setDraft((d) => {
    if (d.coverUrl) URL.revokeObjectURL(d.coverUrl);
    // новая картинка — новый прогон загрузки
    return { ...d, cover: file, coverUrl: file ? URL.createObjectURL(file) : undefined, coverUploaded: undefined, coverProgress: undefined };
  });
}

const dropDraft = (): Draft => {
  if (state.draft.coverUrl) URL.revokeObjectURL(state.draft.coverUrl);
  return emptyDraft();
};

export function updateTrack(id: string, patch: Partial<Pick<DraftTrack, 'title' | 'explicit'>>) {
  const t = state.draft.tracks.find((x) => x.id === id);
  if (!t || t.trackUuid) return; // трек уже создан в каталоге — API не умеет его менять
  patchTrack(id, patch);
}

export function moveTrack(from: number, to: number) {
  if (isDraftLocked(state.draft) || from === to) return;
  setDraft((d) => {
    const tracks = [...d.tracks];
    const [m] = tracks.splice(from, 1);
    tracks.splice(to, 0, m);
    return { ...d, tracks };
  });
}

export function setDraftTarget(target: DraftTarget) {
  if (isDraftLocked(state.draft)) return false;
  setDraft((d) => ({
    ...d,
    target,
    title: target.kind === 'existing' ? target.albumName : '',
    artist: target.kind === 'existing' ? target.artistName : '',
    artistUuid: undefined,
    artistName: undefined,
    albumUuid: undefined,
    error: undefined,
  }));
  return true;
}

/** Сбросить черновик: не созданные на сервере треки возвращаются в очередь. */
export function resetDraft() {
  if (state.draft.publishing) return;
  const back = state.draft.tracks
    .filter((t) => !t.trackUuid)
    .map((t): QueueItem => ({ id: t.id, file: t.file, stage: 'READY', meta: t.meta }));
  set((s) => ({ queue: [...s.queue, ...back], draft: dropDraft() }));
}

// ---------- публикация ----------

const norm = (s: string) => s.trim().toLocaleLowerCase('ru');

async function resolveArtist(name: string) {
  const find = async () => (await catalog.searchArtists(name.trim(), { limit: 50 })).find((a) => norm(a.artist_name) === norm(name));
  const existing = await find();
  if (existing) return existing.artist_uuid;
  try {
    return (await catalog.addArtist(name.trim())).artist_uuid;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const again = await find();
      if (again) return again.artist_uuid;
    }
    throw e;
  }
}


export interface PublishResult {
  albumUuid: string;
  title: string;
  count: number;
}

export async function publishDraft(): Promise<PublishResult> {
  const d0 = state.draft;
  if (d0.publishing) throw new Error('публикация уже идёт');
  if (!d0.title.trim() || !d0.artist.trim()) throw new Error('нужны название и исполнитель');
  if (!d0.tracks.length) throw new Error('в черновике нет треков');
  const untitled = d0.tracks.findIndex((t) => !t.title.trim());
  if (untitled >= 0) throw new Error(`у трека ${untitled + 1} нет названия`);

  setDraft((d) => ({ ...d, publishing: true, error: undefined }));
  try {
    const target = d0.target;
    let artistUuid = target.kind === 'existing' ? target.artistUuid : d0.artistUuid;
    if (!artistUuid) {
      artistUuid = await resolveArtist(d0.artist);
      setDraft((d) => ({ ...d, artistUuid }));
    }

    let albumUuid = target.kind === 'existing' ? target.albumUuid : d0.albumUuid;
    if (!albumUuid) {
      albumUuid = (await catalog.addAlbum({ artist_uuid: artistUuid, album_name: d0.title.trim() })).album_uuid;
      setDraft((d) => ({ ...d, albumUuid }));
    }

    const base = target.kind === 'existing' ? target.basePosition : 0;
    const tracks = state.draft.tracks;

    for (let i = 0; i < tracks.length; i++) {
      const t = state.draft.tracks[i];
      if (t.phase === 'done') continue;
      try {
        let trackUuid = t.trackUuid;
        if (!trackUuid) {
          patchTrack(t.id, { phase: 'index', error: undefined });
          const created = await catalog.addTrack({
            track_name: t.title.trim(),
            artist_uuid: artistUuid,
            album_uuid: albumUuid,
            explicit: t.explicit,
            duration_ms: t.meta.durationMs ?? 0,
            path: t.file.name,
          });
          trackUuid = created.track_uuid;
          patchTrack(t.id, { trackUuid });
        }
        if (!t.uploaded) {
          patchTrack(t.id, { phase: 'upload', progress: 0, error: undefined });
          await catalog.uploadTrackFile(trackUuid, t.file, (p) => patchTrack(t.id, { progress: p }));
          patchTrack(t.id, { uploaded: true, progress: 1 });
        }
        patchTrack(t.id, { phase: 'uploaded' });
      } catch (e) {
        patchTrack(t.id, { phase: 'error', error: errorLabel(e) });
        throw e;
      }
    }

    // Обложка — после файлов треков и до позиций: при сбое «Продолжить» повторит
    // только её — треки уже залиты (trackUuid/uploaded), позиции ещё не отправлялись.
    const coverFile = state.draft.cover;
    if (coverFile && !state.draft.coverUploaded) {
      setDraft((d) => ({ ...d, coverProgress: 0 }));
      await catalog.uploadAlbumCover(albumUuid, coverFile, (p) => setDraft((d) => ({ ...d, coverProgress: p })));
      setDraft((d) => ({ ...d, coverUploaded: true }));
    }

    // Позиции в трек-листе — одним запросом, когда все файлы на месте.
    const pending = state.draft.tracks.map((t, i) => ({ t, position: base + i + 1 })).filter(({ t }) => t.phase !== 'done');
    if (pending.length) {
      await catalog.addTracksToAlbum(
        albumUuid,
        pending.map(({ t, position }) => ({ track_uuid: t.trackUuid!, position })),
      );
    }

    const result: PublishResult = { albumUuid, title: d0.title.trim(), count: state.draft.tracks.length };
    set((s) => ({ ...s, draft: dropDraft() }));
    return result;
  } catch (e) {
    setDraft((d) => ({ ...d, publishing: false, error: errorLabel(e) }));
    throw e;
  }
}

export const trackQuality = (t: { meta: AudioMeta }) => audioQuality(t.meta);
