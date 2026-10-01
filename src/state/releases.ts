import { useSyncExternalStore } from 'react';
import { catalog } from '../api/endpoints';
import { ApiError, errorLabel } from '../api/http';

import { audioQuality, isAudio, isImage, probeAudio, type AudioMeta } from '../lib/metadata';
import { mapPool } from '../lib/pool';

// Загрузка релиза поверх API v1. Контракт не даёт серверной очереди индексации,
// поэтому файлы разбираются в браузере (ffprobe/теги → music-metadata), а
// публикация — это цепочка вызовов Gateway:
//   AddArtist (или поиск существующего) → AddAlbum → [AddTrack → POST /tracks/{id}/file]×N → AddTracksToAlbum
// Метаданные переживают перезагрузку (localStorage), сами File — нет: после
// сбоя треки помечаются «файл не прикреплён», и браузер просит выбрать их заново.

export type QueueStage = 'PROBE' | 'READY' | 'ERROR' | 'MISSING';

export interface QueueItem {
  id: string;
  /** null — файл потерян при перезагрузке вкладки, нужно прикрепить заново. */
  file: File | null;
  stage: QueueStage;
  meta?: AudioMeta;
  error?: string;
  /** Ключ ожидаемого файла (имя:размер:mtime) для повторного прикрепления. */
  expectKey?: string;
}

export type TrackPhase = 'idle' | 'index' | 'upload' | 'uploaded' | 'done' | 'error';

export interface DraftTrack {
  id: string;
  /** null — файл потерян при перезагрузке вкладки, нужно прикрепить заново. */
  file: File | null;
  meta: AudioMeta;
  title: string;
  explicit: boolean;
  trackUuid?: string;
  uploaded?: boolean;
  progress: number;
  phase: TrackPhase;
  error?: string;
  /** Ключ ожидаемого файла (имя:размер:mtime) для повторного прикрепления. */
  expectKey?: string;
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
  /** Имя обложки, сохранённое до перезагрузки: сам файл выбрать нужно заново. */
  coverName?: string;
  coverLost?: boolean;
  /** Прогресс и статус загрузки обложки внутри публикации. */
  coverUploaded?: boolean;
  coverProgress?: number;
  publishing: boolean;
  error?: string;
}

export interface ReleasesState {
  queue: QueueItem[];
  draft: Draft;
  /** Черновик восстановлен из localStorage — файлы, возможно, нужно прикрепить заново. */
  restored: boolean;
}

const emptyDraft = (): Draft => ({ target: { kind: 'new' }, title: '', artist: '', tracks: [], publishing: false });

// ---------- сохранение черновика между перезагрузками ----------

const STORE_KEY = 'privy.admin.releases.v1';

interface StoredTrack {
  id: string;
  fileName: string;
  size: number;
  lastModified: number;
  title: string;
  explicit: boolean;
  trackUuid?: string;
  uploaded?: boolean;
  phase: TrackPhase;
  error?: string;
  meta: AudioMeta;
}

interface StoredQueue {
  id: string;
  fileName: string;
  size: number;
  lastModified: number;
  error?: string;
  meta?: AudioMeta;
}

interface StoredState {
  queue: StoredQueue[];
  draft: {
    target: DraftTarget;
    title: string;
    artist: string;
    artistUuid?: string;
    artistName?: string;
    albumUuid?: string;
    coverName?: string;
    tracks: StoredTrack[];
  };
}

/** Треку файл ещё нужен: без него не создать запись и не залить аудио. */
export const trackNeedsFile = (t: DraftTrack) => !(t.trackUuid && t.uploaded) && t.phase !== 'done';

function serialize(): string | null {
  const { queue, draft } = state;
  if (!queue.length && !draft.tracks.length && !draft.title && !draft.artist) return null;
  const st: StoredState = {
    queue: queue.map((q) => ({
      id: q.id,
      fileName: q.file?.name ?? '',
      size: q.file?.size ?? 0,
      lastModified: q.file?.lastModified ?? 0,
      error: q.stage === 'ERROR' ? q.error : undefined,
      meta: q.meta,
    })),
    draft: {
      target: draft.target,
      title: draft.title,
      artist: draft.artist,
      artistUuid: draft.artistUuid,
      artistName: draft.artistName,
      albumUuid: draft.albumUuid,
      coverName: draft.cover?.name ?? (draft.coverLost ? draft.coverName : undefined),
      tracks: draft.tracks.map((t) => ({
        id: t.id,
        fileName: t.file?.name ?? t.meta.title,
        size: t.file?.size ?? 0,
        lastModified: t.file?.lastModified ?? 0,
        title: t.title,
        explicit: t.explicit,
        trackUuid: t.trackUuid,
        uploaded: t.uploaded,
        phase: t.phase,
        error: t.error,
        meta: t.meta,
      })),
    },
  };
  return JSON.stringify(st);
}

function applyStored(raw: string): ReleasesState {
  const st = JSON.parse(raw) as StoredState;
  const queue: QueueItem[] = st.queue
    .filter((q) => q.fileName)
    .map((q) => ({
      id: q.id,
      file: null,
      // Файл после перезагрузки не восстановить — ждём повторного выбора.
      stage: 'MISSING' as const,
      meta: q.meta,
      error: 'файл не прикреплён — выбери его заново',
      expectKey: `${q.fileName}:${q.size}:${q.lastModified}`,
    }));
  const draft: Draft = {
    ...emptyDraft(),
    target: st.draft.target,
    title: st.draft.title,
    artist: st.draft.artist,
    artistUuid: st.draft.artistUuid,
    artistName: st.draft.artistName,
    albumUuid: st.draft.albumUuid,
    coverName: st.draft.coverName,
    coverLost: !!st.draft.coverName,
    tracks: st.draft.tracks.map(
      (t): DraftTrack => ({
        id: t.id,
        file: null,
        meta: t.meta,
        title: t.title,
        explicit: t.explicit,
        trackUuid: t.trackUuid,
        uploaded: t.uploaded,
        progress: 0,
        phase: t.phase,
        error: t.error,
        expectKey: `${t.fileName}:${t.size}:${t.lastModified}`,
      }),
    ),
  };
  return { queue, draft, restored: queue.length > 0 || draft.tracks.length > 0 };
}

function loadStored(): ReleasesState | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? applyStored(raw) : null;
  } catch {
    return null;
  }
}

let persistTimer: number | undefined;

function persistNow() {
  try {
    const raw = serialize();
    if (raw) localStorage.setItem(STORE_KEY, raw);
    else localStorage.removeItem(STORE_KEY);
  } catch {
    // приватный режим или переполнение — черновик просто не переживёт перезагрузку
  }
}

function persistSoon() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(persistNow, 400);
}

/** Записать черновик немедленно — для beforeunload/pagehide. */
export function flushDraft() {
  window.clearTimeout(persistTimer);
  persistNow();
}

const listeners = new Set<() => void>();
let seq = 0;

let state: ReleasesState = { queue: [], draft: emptyDraft(), restored: false };
const storedState = loadStored();
if (storedState) {
  state = storedState;
  // id вида f12 — продолжаем нумерацию после восстановленных
  for (const t of [...state.queue, ...state.draft.tracks]) {
    const n = /^f(\d+)$/.exec(t.id);
    if (n) seq = Math.max(seq, Number(n[1]));
  }
}

function set(fn: (s: ReleasesState) => ReleasesState) {
  state = fn(state);
  persistSoon();
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

/** Сколько файлов ждёт повторного выбора после перезагрузки (очередь + черновик). */
export function missingFileCount(s: ReleasesState) {
  return s.queue.filter((q) => !q.file).length + s.draft.tracks.filter((t) => !t.file && trackNeedsFile(t)).length;
}

/** Убрать плашку «восстановлено после перезагрузки». */
export function clearRestored() {
  if (state.restored) set((s) => ({ ...s, restored: false }));
}

// ---------- очередь ----------

async function probe(item: QueueItem) {
  if (!item.file) {
    patchQueue(item.id, { stage: 'MISSING', error: 'файл не прикреплён — выбери его заново' });
    return;
  }
  patchQueue(item.id, { stage: 'PROBE', error: undefined });
  try {
    const meta = await probeAudio(item.file);
    if (!meta.durationMs) throw new Error('не удалось определить длительность');
    patchQueue(item.id, { stage: 'READY', meta, error: undefined });
  } catch (e) {
    patchQueue(item.id, { stage: 'ERROR', error: errorLabel(e) || 'файл не читается' });
  }
}

const fileKey = (f: File) => `${f.webkitRelativePath || f.name}:${f.size}:${f.lastModified}`;
// Для повторного прикрепления: webkitRelativePath зависит от способа выбора
// (папка или файлы по одному), имя+размер+mtime — нет.
const matchKey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`;

export function addFiles(files: File[]) {
  const audio = files.filter(isAudio);
  const images = files.filter((f) => !isAudio(f) && isImage(f)).length;
  const other = files.length - audio.length - images;
  const known = new Set(
    [...state.queue.map((q) => q.file), ...state.draft.tracks.map((t) => t.file)].filter((f): f is File => !!f).map(fileKey),
  );
  const fresh = audio.filter((f) => !known.has(fileKey(f)));
  const items: QueueItem[] = fresh.map((file) => ({ id: `f${++seq}`, file, stage: 'PROBE' }));
  set((s) => ({ ...s, queue: [...s.queue, ...items] }));
  void mapPool(items, 2, probe);
  return { added: items.length, duplicates: audio.length - fresh.length, images, other };
}

/** Прикрепить файлы заново после перезагрузки: совпадение по имя+размер+mtime. */
export function attachFiles(files: File[]): number {
  const idx = new Map<string, File>();
  for (const f of files.filter(isAudio)) idx.set(matchKey(f), f);
  if (!idx.size) return 0;
  let matched = 0;
  const reprobe: QueueItem[] = [];
  const redraft: DraftTrack[] = [];
  const queue = state.queue.map((q) => {
    if (q.file || !q.expectKey) return q;
    const f = idx.get(q.expectKey);
    if (!f) return q;
    matched++;
    const next = { ...q, file: f, stage: 'PROBE' as const, error: undefined };
    reprobe.push(next);
    return next;
  });
  const tracks = state.draft.tracks.map((t) => {
    if (t.file || !t.expectKey) return t;
    const f = idx.get(t.expectKey);
    if (!f) return t;
    matched++;
    const next = { ...t, file: f, error: undefined };
    redraft.push(next);
    return next;
  });
  if (!matched) return 0;
  const missingLeft =
    queue.some((q) => !q.file) || tracks.some((t) => !t.file && trackNeedsFile(t));
  set((s) => ({ ...s, queue, draft: { ...s.draft, tracks }, restored: missingLeft && s.restored }));
  void mapPool(reprobe, 2, probe);
  // Файл мог оказаться другим — перечитываем теги, чтобы метаданные не врали.
  void mapPool(redraft, 2, async (t) => {
    if (!t.file) return;
    try {
      const meta = await probeAudio(t.file);
      if (!meta.durationMs) throw new Error('не удалось определить длительность');
      patchTrack(t.id, { meta, error: undefined });
    } catch (e) {
      patchTrack(t.id, { phase: 'error', error: errorLabel(e) || 'файл не читается' });
    }
  });
  return matched;
}

export function retryProbe(id: string) {
  const item = state.queue.find((q) => q.id === id);
  if (item) void probe(item);
}

export function removeFromQueue(id: string) {
  set((s) => ({ ...s, queue: s.queue.filter((q) => q.id !== id) }));
}

/** Убрать из очереди всё разом: файлы остаются на диске, просто зона чистится. */
export function clearQueue() {
  set((s) => ({ ...s, queue: [] }));
}

// ---------- черновик ----------

const byTrackOrder = (a: QueueItem, b: QueueItem) =>
  (a.meta?.discNo ?? 1) - (b.meta?.discNo ?? 1) ||
  (a.meta?.trackNo ?? 9999) - (b.meta?.trackNo ?? 9999) ||
  (a.file?.name ?? '').localeCompare(b.file?.name ?? '', 'ru', { numeric: true });

export function addToDraft(ids?: string[]) {
  if (isDraftLocked(state.draft)) return 0;
  const picked = state.queue.filter((q) => q.stage === 'READY' && (!ids || ids.includes(q.id))).sort(byTrackOrder);
  if (!picked.length) return 0;
  const first = picked[0].meta!;
  set((s) => ({
    queue: s.queue.filter((q) => !picked.includes(q)),
    restored: s.restored,
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
    queue: [
      ...s.queue,
      t.file
        ? { id: t.id, file: t.file, stage: 'READY' as const, meta: t.meta }
        : { id: t.id, file: null, stage: 'MISSING' as const, meta: t.meta, error: 'файл не прикреплён — выбери его заново', expectKey: t.expectKey },
    ],
    restored: s.restored,
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
    // новая картинка — новый прогон загрузки; явный выбор снимает «потеряна»
    return {
      ...d,
      cover: file,
      coverUrl: file ? URL.createObjectURL(file) : undefined,
      coverName: file?.name,
      coverLost: false,
      coverUploaded: undefined,
      coverProgress: undefined,
    };
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
    .map((t): QueueItem =>
      t.file
        ? { id: t.id, file: t.file, stage: 'READY', meta: t.meta }
        : { id: t.id, file: null, stage: 'MISSING', meta: t.meta, error: 'файл не прикреплён — выбери его заново', expectKey: t.expectKey },
    );
  set((s) => ({ queue: [...s.queue, ...back], draft: dropDraft(), restored: back.some((q) => !q.file) && s.restored }));
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
  const lost = d0.tracks.filter((t) => trackNeedsFile(t) && !t.file).length;
  if (lost) throw new Error(`не прикреплено файлов: ${lost} — выбери их заново`);

  console.log('S1 start');
  setDraft((d) => ({ ...d, publishing: true, error: undefined }));
  try {
    const target = d0.target;
    let artistUuid = target.kind === 'existing' ? target.artistUuid : d0.artistUuid;
    let albumUuid = target.kind === 'existing' ? target.albumUuid : d0.albumUuid;

    // Черновик мог остаться от прерванной публикации, а записи на узле тем
    // временем удалены (вручную или через каталог): без проверки «Продолжить»
    // падает в середине — например, 404 на обложке удалённого альбома, при
    // этом треки уже залиты и остаются висеть без позиций.
    if (albumUuid) {
      try {
        await catalog.getAlbum(albumUuid);
      } catch (e) {
        if (!(e instanceof ApiError) || e.status !== 404) throw e;
        if (target.kind === 'existing') throw new Error('релиза больше нет на узле — сбрось черновик и начни заново');
        // Новый релиз: альбом прерванной публикации удалён — публикуем заново,
        // артист найдётся по имени, треки пересоздадутся на своих местах.
        setDraft((d) => ({
          ...d,
          albumUuid: undefined,
          artistUuid: undefined,
          tracks: d.tracks.map((t) => ({ ...t, trackUuid: undefined, uploaded: undefined, progress: 0, phase: 'idle' as const })),
        }));
        artistUuid = undefined;
        albumUuid = undefined;
      }
    }

    console.log('S2 checks done');
    if (!artistUuid) {
      artistUuid = await resolveArtist(d0.artist);
      setDraft((d) => ({ ...d, artistUuid }));
    }

    console.log('S3 artist done');
    if (!albumUuid) {
      albumUuid = (await catalog.addAlbum({ artist_uuid: artistUuid, album_name: d0.title.trim() })).album_uuid;
      setDraft((d) => ({ ...d, albumUuid }));
    }

    console.log('S4 album done');
    const base = target.kind === 'existing' ? target.basePosition : 0;
    const tracks = state.draft.tracks;

    for (let i = 0; i < tracks.length; i++) {
      const t = state.draft.tracks[i];
      if (t.phase === 'done') continue;
      try {
        let trackUuid = t.trackUuid;
        // Трек из прерванной публикации могли удалить на узле — пересоздаём,
        // иначе загрузка файла упадёт с 404 посреди «Продолжить».
        if (trackUuid) {
          const exists = await catalog.trackExists(trackUuid).then((r) => r.exists, () => false);
          if (!exists) {
            patchTrack(t.id, { trackUuid: undefined, uploaded: undefined, progress: 0, phase: 'idle' });
            trackUuid = undefined;
          }
        }
        if (!trackUuid) {
          if (!t.file) throw new Error('файл трека не прикреплён');
          console.log('S5 creating');
          patchTrack(t.id, { phase: 'index', error: undefined });
          const created = await catalog.addTrack({
            track_name: t.title.trim(),
            artist_uuid: artistUuid,
            album_uuid: albumUuid,
            explicit: t.explicit,
            duration_ms: t.meta.durationMs ?? 0,
            path: t.file.name,
          });
          console.log('S6 created');
          trackUuid = created.track_uuid;
          patchTrack(t.id, { trackUuid });
        }
        if (!t.uploaded) {
          if (!t.file) throw new Error('файл трека не прикреплён');
          patchTrack(t.id, { phase: 'upload', progress: 0, error: undefined });
          console.log('S7 uploading');
          await catalog.uploadTrackFile(trackUuid, t.file, (p) => patchTrack(t.id, { progress: p }));
          console.log('S8 uploaded');
          patchTrack(t.id, { uploaded: true, progress: 1 });
        }
        console.log('S9 phase uploaded');
        patchTrack(t.id, { phase: 'uploaded' });
      } catch (e) {
        patchTrack(t.id, { phase: 'error', error: errorLabel(e) });
        throw e;
      }
    }

    console.log('S10 tracks loop done');
    // Обложка — после файлов треков и до позиций: при сбое «Продолжить» повторит
    // только её — треки уже залиты (trackUuid/uploaded), позиции ещё не отправлялись.
    const coverFile = state.draft.cover;
    if (coverFile && !state.draft.coverUploaded) {
      console.log('S11 cover upload');
      setDraft((d) => ({ ...d, coverProgress: 0 }));
      await catalog.uploadAlbumCover(albumUuid, coverFile, (p) => setDraft((d) => ({ ...d, coverProgress: p })));
      setDraft((d) => ({ ...d, coverUploaded: true }));
    }

    // Позиции в трек-листе — одним запросом, когда все файлы на месте.
    console.log('S12 cover done');
    const pending = state.draft.tracks.map((t, i) => ({ t, position: base + i + 1 })).filter(({ t }) => t.phase !== 'done');
    if (pending.length) {
      await catalog.addTracksToAlbum(
        albumUuid,
        pending.map(({ t, position }) => ({ track_uuid: t.trackUuid!, position })),
      );
    }

    console.log('S13 positions done');
    const result: PublishResult = { albumUuid, title: d0.title.trim(), count: state.draft.tracks.length };
    set((s) => ({ ...s, draft: dropDraft() }));
    return result;
  } catch (e) {
    setDraft((d) => ({ ...d, publishing: false, error: errorLabel(e) }));
    throw e;
  }
}

export const trackQuality = (t: { meta: AudioMeta }) => audioQuality(t.meta);
