import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { releaseType } from '../api/catalogIndex';
import { catalog as catalogApi } from '../api/endpoints';
import { errorLabel } from '../api/http';
import type { Artist } from '../api/types';
import { Chip, Cover, ErrorLine, ScreenHeader, TrashIcon, UploadIcon, useConfirm } from '../components/ui';
import { fmtBytes, fmtDuration, pad2, shortId } from '../lib/format';
import { audioQuality, extOf, filesFromDataTransfer, imageSize, isImage } from '../lib/metadata';
import { CATALOG_KEY, useCatalogIndex } from '../state/queries';
import {
  addFiles,
  addToDraft,
  attachFiles,
  clearQueue,
  clearRestored,
  flushDraft,
  isDraftLocked,
  missingFileCount,
  moveTrack,
  publishDraft,
  removeFromQueue,
  resetDraft,
  retryProbe,
  returnToQueue,
  setDraftTarget,
  setDraftCover,
  trackNeedsFile,
  updateDraft,
  updateTrack,
  useReleases,
  COVER_MAX_SIDE,
  COVER_EXTENSIONS,
  type DraftTrack,
  type QueueItem,
} from '../state/releases';
import { useToast } from '../state/toast';

/** Имя потерянного файла из ключа «имя:размер:mtime» (имя может содержать двоеточия). */
const storedName = (key: string | undefined) => (key ? key.split(':').slice(0, -2).join(':') : '');

function QueueRow({ q, canAdd }: { q: QueueItem; canAdd: boolean }) {
  const m = q.meta;
  const missing = !q.file;
  const name = q.file?.name || storedName(q.expectKey) || 'файл';
  // Название из тегов — главное в строке; пока тегов нет, показываем имя файла
  const titled = m?.titleFromTags ? m.title : '';
  const main = titled || name;
  const meta = [
    q.file ? fmtBytes(q.file.size) : null,
    m?.durationMs ? fmtDuration(m.durationMs) : null,
    m ? audioQuality(m) || m.codec : extOf(name).toUpperCase(),
    m?.explicit ? '18+ из тегов' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const stageLabel =
    q.stage === 'PROBE' ? 'Обработка…' : q.stage === 'READY' ? 'Готово' : q.stage === 'MISSING' ? 'Нет файла' : 'Ошибка';
  const stageCls = q.stage === 'READY' ? ' c-ok' : q.stage === 'ERROR' ? ' c-err' : q.stage === 'MISSING' ? ' c-warn' : '';
  const width = q.stage === 'READY' || q.stage === 'ERROR' ? 100 : 50;
  const color = q.stage === 'PROBE' ? 'var(--accent)' : q.stage === 'ERROR' ? 'var(--err)' : 'var(--stroke)';
  return (
    <div className={`q-row${missing ? ' missing' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ borderRadius: 6, overflow: 'hidden', flex: 'none' }} aria-hidden>
          <Cover seed={m?.title || name} size={36} />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0, flex: 1 }}>
          <span className="q-title" title={main}>
            {main}
          </span>
          {titled && m?.artist?.trim() && (
            <span className="hint" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {m.artist}
            </span>
          )}
          <span className="q-name" title={name}>
            {name}
            {meta ? ` · ${meta}` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 7, flex: 'none' }}>
          {m?.durationMs ? <span className={`stage${stageCls}`}>{fmtDuration(m.durationMs)}</span> : null}
          <span className={`stage${stageCls}`}>{stageLabel}</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {q.stage === 'ERROR' && (
              <button type="button" className="btn xs" title="Разобрать заново" onClick={() => retryProbe(q.id)}>
                ↻
              </button>
            )}
            {q.stage === 'READY' && canAdd && (
              <button type="button" className="btn xs" title="Добавить в черновик" onClick={() => addToDraft([q.id])}>
                +
              </button>
            )}
            <button type="button" className="icon-btn" title="Убрать из очереди" onClick={() => removeFromQueue(q.id)}>
              ×
            </button>
          </div>
        </div>
      </div>
      <div className="bar">
        <div style={{ width: `${width}%`, background: color }} />
      </div>
      {q.error && <span style={{ font: '400 11px/1.4 var(--mono)', color: 'var(--accent-text)' }}>{q.error}</span>}
    </div>
  );
}

function phaseLabel(t: DraftTrack) {
  if (!t.file && trackNeedsFile(t)) return 'НЕТ ФАЙЛА';
  switch (t.phase) {
    case 'index':
      return 'INDEX';
    case 'upload':
      return `UPLOAD ${Math.round(t.progress * 100)}%`;
    case 'uploaded':
      return 'ФАЙЛ ЗАЛИТ';
    case 'done':
      return 'ГОТОВ';
    case 'error':
      return 'ОШИБКА';
    // Статус «ожидает» виден всегда: у публикации честная очередь шагов
    default:
      return t.trackUuid ? 'СОЗДАН' : 'ОЖИДАЕТ';
  }
}

export function Releases() {
  const state = useReleases();
  const { queue, draft } = state;
  const toast = useToast();
  const qc = useQueryClient();
  const catalog = useCatalogIndex();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { confirm, node: confirmNode } = useConfirm();
  const filesInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);
  const attachInput = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  const locked = isDraftLocked(draft);
  const existing = draft.target.kind === 'existing' ? draft.target : null;
  const missing = missingFileCount(state);

  // Метаданные черновика переживают перезагрузку (localStorage), File — нет:
  // предупреждаем только когда терять нечего, и сбрасываем буфер сохранения.
  const unsaved = queue.length > 0 || draft.tracks.length > 0 || draft.publishing;
  useEffect(() => {
    if (!unsaved) return;
    const warn = (e: BeforeUnloadEvent) => {
      flushDraft();
      e.preventDefault();
      e.returnValue = '';
    };
    const hide = () => flushDraft();
    window.addEventListener('beforeunload', warn);
    window.addEventListener('pagehide', hide);
    return () => {
      window.removeEventListener('beforeunload', warn);
      window.removeEventListener('pagehide', hide);
    };
  }, [unsaved]);

  // Подсказки артиста: имя ищется в каталоге узла с debounce, выбор подставляет
  // его uuid в публикацию; без выбора имя уйдёт в AddArtist как новый артист.
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [debouncedArtist, setDebouncedArtist] = useState('');
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedArtist(draft.artist), 250);
    return () => window.clearTimeout(t);
  }, [draft.artist]);
  const canSuggest = suggestOpen && !existing && !locked && debouncedArtist.trim().length > 0;
  const suggest = useQuery({
    queryKey: ['artist-suggest', debouncedArtist.trim()],
    queryFn: () => catalogApi.searchArtists(debouncedArtist.trim(), { limit: 8 }),
    enabled: canSuggest,
  });
  const pickArtist = (a: Artist) => {
    updateDraft({ artist: a.artist_name, artistUuid: a.artist_uuid, artistName: a.artist_name });
    setSuggestOpen(false);
  };

  // /releases?album={uuid} — дозалить треки в существующий релиз (пришли из каталога).
  const albumParam = params.get('album');
  useEffect(() => {
    if (!albumParam || !catalog.data) return;
    const a = catalog.data.albums.find((x) => x.album_uuid === albumParam);
    if (a && (draft.target.kind !== 'existing' || draft.target.albumUuid !== a.album_uuid)) {
      const ok = setDraftTarget({
        kind: 'existing',
        albumUuid: a.album_uuid,
        albumName: a.album_name,
        artistUuid: a.artist_uuid,
        artistName: a.artist_name,
        basePosition: a.tracks.length,
      });
      if (!ok) toast('Черновик занят публикацией — сначала заверши её');
    }
    setParams({}, { replace: true });
  }, [albumParam, catalog.data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Обложка поедет на узел в публикации: фильтруем формат (белый список
  // контракта) и размер до 3000×3000 ещё до загрузки. Возвращает причину
  // отказа: из зоны она попадает в сводный тост очереди, из кнопки — тостится сама.
  const pickCover = async (file: File | undefined, notify = true): Promise<string | undefined> => {
    if (!file) return undefined;
    const fail = (msg: string) => {
      if (notify) toast(msg);
      return msg;
    };
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!COVER_EXTENSIONS.includes(ext)) {
      return fail(`Формат .${ext || '—'} узел не примет — обложка: ${COVER_EXTENSIONS.join(', ')}`);
    }
    const size = await imageSize(file);
    if (!size || size.w > COVER_MAX_SIDE || size.h > COVER_MAX_SIDE) {
      return fail(
        size
          ? `Обложка ${size.w}×${size.h} — больше лимита ${COVER_MAX_SIDE}×${COVER_MAX_SIDE}, не принята`
          : 'Обложку не удалось прочитать — не принята',
      );
    }
    setDraftCover(file);
    return undefined;
  };

  const ingest = async (files: File[]) => {
    if (!files.length) return;
    // Картинка из общей зоны не теряется: первая уходит в обложку релиза.
    const image = files.find(isImage);
    const coverFail = image ? await pickCover(image, false) : undefined;
    const r = addFiles(files);
    const parts = [`В очередь: ${r.added}`];
    if (r.duplicates) parts.push(`повторов ${r.duplicates}`);
    if (r.images) parts.push(coverFail ?? 'картинка — в обложку релиза');
    if (r.other) parts.push(`не аудио ${r.other}`);
    toast(parts.join(' · '));
  };

  const onDrop = async (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    ingest(await filesFromDataTransfer(e.dataTransfer));
  };

  const ready = queue.filter((q) => q.stage === 'READY').length;
  const probing = queue.filter((q) => q.stage === 'PROBE').length;
  const totalMs = draft.tracks.reduce((s, t) => s + (t.meta.durationMs ?? 0), 0);
  const type = releaseType((existing?.basePosition ?? 0) + draft.tracks.length);
  const untitled = draft.tracks.filter((t) => !t.title.trim()).length;
  const lostTracks = draft.tracks.filter((t) => !t.file && trackNeedsFile(t)).length;
  const canPublish = !!draft.title.trim() && !!draft.artist.trim() && draft.tracks.length > 0 && !untitled && !lostTracks && !draft.publishing;
  const resumable = !draft.publishing && (!!draft.albumUuid || draft.tracks.some((t) => t.trackUuid));

  const attach = (files: File[]) => {
    const n = attachFiles(files);
    toast(n ? `Прикреплено файлов: ${n}` : 'Совпадений по имени и размеру не нашлось — проверь, те ли файлы выбраны');
  };

  const addAll = () => {
    const n = addToDraft();
    if (n) toast(`В релиз добавлено: ${n} тр.`);
  };

  const publish = async () => {
    try {
      const r = await publishDraft();
      qc.invalidateQueries({ queryKey: CATALOG_KEY });
      toast(`«${r.title}» опубликован · ${shortId(r.albumUuid)}`, {
        label: 'Открыть в каталоге',
        onClick: () => navigate(`/catalog/${r.albumUuid}`),
      });
    } catch (e) {
      toast(`Публикация остановлена · ${errorLabel(e)}`);
    }
  };

  const reset = async () => {
    if (resumable) {
      const ok = await confirm(
        'Бросить незавершённую публикацию?',
        'Альбом и часть треков уже созданы в каталоге. Несозданные треки вернутся в очередь; созданные останутся на узле — убрать их можно в каталоге, крестиком у трека.',
        'Сбросить',
      );
      if (!ok) return;
    }
    resetDraft();
  };

  const typeNote = existing
    ? `Треки добавятся в конец «${existing.albumName}» — с позиции ${existing.basePosition + 1}.`
    : draft.tracks.length === 1
      ? 'Сингл — тот же альбом, просто с одним треком. Тип в API не хранится: подпись выводится из числа треков.'
      : 'Все разобранные файлы из очереди можно добавить в релиз одним действием. Порядок — по номеру трека из тегов, дальше перетаскиванием.';

  const addAllLabel = ready
    ? `+ Добавить треки из очереди · ${ready}`
    : probing
      ? `Ждём разбор тегов · ${probing}`
      : 'Нет готовых файлов';

  const onRowDrop = (to: number) => {
    if (dragIdx !== null) moveTrack(dragIdx, to);
    setDragIdx(null);
    setDropIdx(null);
  };

  return (
    <>
      <ScreenHeader
        code="02 · Загрузка"
        title="Добавить релиз"
        sub="Загрузите аудиофайлы и обложку — теги распознаются в браузере, и из готовых файлов соберётся черновик релиза. Сингл — тот же альбом с одним треком; порядок треков меняется перетаскиванием или кнопками ↑ ↓."
      />
      {state.restored && (
        <div className="restore-note" role="status">
          <span>
            Черновик восстановлен после перезагрузки: названия, порядок и статусы публикации на месте
            {missing ? ` · ждут повторного выбора файлов: ${missing}` : ''}. Сами файлы браузер сохранить не может.
          </span>
          <span style={{ display: 'flex', gap: 10, flex: 'none' }}>
            {missing > 0 && (
              <button type="button" className="btn sm" onClick={() => attachInput.current?.click()}>
                Прикрепить файлы
              </button>
            )}
            <button type="button" className="link-muted" onClick={clearRestored}>
              Скрыть
            </button>
          </span>
        </div>
      )}
      <input
        ref={attachInput}
        type="file"
        multiple
        accept="audio/*,.flac,.m4a,.alac,.wav,.mp3,.aiff,.ogg,.opus"
        hidden
        onChange={(e) => {
          attach(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
      <div className="two-col">
        <div className="stack gap-16" style={{ minWidth: 0 }}>
          <div
            className={`dropzone${over ? ' over' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => filesInput.current?.click()}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && filesInput.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
          >
            <div aria-hidden style={{ color: 'var(--accent)', display: 'flex' }}>
              <UploadIcon size={26} />
            </div>
            <div className="dropzone-title">Перетащи файлы или папку сюда</div>
            <div className="note">FLAC · ALAC · WAV · MP3 · картинка из зоны станет обложкой релиза</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <span className="btn-accent">Выбрать файлы</span>
              <button
                type="button"
                className="btn"
                onClick={(e) => {
                  e.stopPropagation();
                  dirInput.current?.click();
                }}
              >
                Выбрать папку
              </button>
            </div>
            <input
              ref={filesInput}
              type="file"
              multiple
              accept="audio/*,.flac,.m4a,.alac,.wav,.mp3,.aiff,.ogg,.opus"
              hidden
              onChange={(e) => {
                ingest(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <input
              ref={dirInput}
              type="file"
              hidden
              // @ts-expect-error нестандартный атрибут выбора папки
              webkitdirectory=""
              onChange={(e) => {
                ingest(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
          </div>

          <div className="section-head" style={{ alignItems: 'center' }}>
            <div className="label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Файлы в очереди
              <span className="tag muted">{queue.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <span className="hint" style={{ letterSpacing: '.06em' }}>
                PROBE → TAGS → INDEX → UPLOAD
              </span>
              {queue.length > 0 && (
                <button
                  type="button"
                  className="link-muted"
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  onClick={clearQueue}
                >
                  <TrashIcon size={13} />
                  Очистить все
                </button>
              )}
            </div>
          </div>
          <div className="list">
            {queue.map((q) => (
              <QueueRow key={q.id} q={q} canAdd={!locked} />
            ))}
            {!queue.length && <div className="empty">Очередь пуста — перетащи аудиофайлы в зону выше.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-head">
            <span className="label">{existing ? 'Добавление в релиз' : 'Черновик релиза'}</span>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {existing && !locked && (
                <Chip onClick={() => setDraftTarget({ kind: 'new' })}>Новый релиз ×</Chip>
              )}
              {ready > 0 && (
                <span className="tag ok" title="Разобранные файлы очереди можно добавить в черновик">
                  ✓ Есть готовые файлы
                </span>
              )}
            </div>
          </div>
          <div className="card-body">
            <div className="field">
              <span className="label">Обложка релиза</span>
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <div style={{ position: 'relative', flex: 'none' }}>
                  <button
                    type="button"
                    className={`draft-cover${draft.coverUrl ? ' has-image' : ''}`}
                    onClick={() => coverInput.current?.click()}
                    disabled={draft.publishing}
                    title={draft.cover ? draft.cover.name : 'Выбрать обложку релиза'}
                    aria-label="Обложка релиза"
                  >
                    {draft.coverUrl ? (
                      <img src={draft.coverUrl} alt="" />
                    ) : (
                      <>
                        нет
                        <br />
                        обложки
                      </>
                    )}
                  </button>
                  {draft.publishing && draft.cover && !draft.coverUploaded && (
                    <div className="bar" style={{ position: 'absolute', left: 4, right: 4, bottom: 4 }}>
                      <div style={{ width: `${Math.max(4, Math.round((draft.coverProgress ?? 0) * 100))}%`, background: 'var(--accent)' }} />
                    </div>
                  )}
                  <input
                    ref={coverInput}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      void pickCover(e.target.files?.[0]);
                      e.target.value = '';
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={draft.publishing}
                      onClick={() => coverInput.current?.click()}
                    >
                      {draft.coverUrl ? 'Заменить обложку' : 'Выбрать обложку'}
                    </button>
                    {draft.coverUrl && (
                      <button
                        type="button"
                        className="icon-btn"
                        title="Убрать обложку"
                        disabled={draft.publishing}
                        onClick={() => setDraftCover(undefined)}
                      >
                        <TrashIcon size={14} />
                      </button>
                    )}
                  </div>
                  <span className="hint">
                    Станет обложкой альбома и всех его треков — POST /catalog/albums/{'{id}'}/cover.{' '}
                    {COVER_EXTENSIONS.join(' · ').toUpperCase()} · до {COVER_MAX_SIDE}×{COVER_MAX_SIDE}.
                  </span>
                  {draft.coverLost && !draft.cover && (
                    <span className="hint c-warn">«{draft.coverName}» не прикреплена — выбери заново</span>
                  )}
                </div>
              </div>
            </div>

            <div className="draft-grid">
              <div className="field">
                <label className="label" htmlFor="draft-title">
                  Название релиза
                </label>
                <input
                  id="draft-title"
                  className="input title"
                  placeholder="Название релиза"
                  value={draft.title}
                  disabled={!!existing || locked}
                  onChange={(e) => updateDraft({ title: e.target.value })}
                  aria-label="Название релиза"
                />
              </div>
              <div className="field">
                <label className="label" htmlFor="draft-type">
                  Тип
                </label>
                <select
                  id="draft-type"
                  className="input"
                  disabled
                  value={type}
                  title="Тип выводится из числа треков — в API v1 не хранится"
                >
                  <option value="Сингл">Сингл</option>
                  <option value="EP">EP</option>
                  <option value="Альбом">Альбом</option>
                </select>
                <span className="hint">из числа треков</span>
              </div>
            </div>

            <div className="field">
              <label className="label" htmlFor="draft-artist">
                Исполнитель
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="draft-artist"
                  className="input"
                  placeholder="Имя артиста"
                  value={draft.artist}
                  disabled={!!existing || locked}
                  autoComplete="off"
                  onChange={(e) => {
                    updateDraft({ artist: e.target.value, artistUuid: undefined, artistName: undefined });
                    setSuggestOpen(true);
                  }}
                  onFocus={() => setSuggestOpen(true)}
                  onBlur={(e) => {
                    if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setSuggestOpen(false);
                  }}
                  onKeyDown={(e) => e.key === 'Escape' && setSuggestOpen(false)}
                  aria-label="Исполнитель"
                />
                {canSuggest && (
                  <div className="suggest">
                    <div className="suggest-list">
                      {suggest.isFetching && !suggest.data?.length && <div className="suggest-note">Поиск по каталогу…</div>}
                      {suggest.data?.map((a) => (
                        <button
                          key={a.artist_uuid}
                          type="button"
                          className={`suggest-item${a.artist_uuid === draft.artistUuid ? ' selected' : ''}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => pickArtist(a)}
                        >
                          {a.artist_name}
                          <span className="suggest-id">{shortId(a.artist_uuid)}</span>
                        </button>
                      ))}
                      {suggest.data && !suggest.data.length && (
                        <div className="suggest-note">Совпадений нет — «{draft.artist.trim()}» зальётся как новый артист.</div>
                      )}
                      {suggest.error && <div className="suggest-note c-err">Поиск не ответил: {errorLabel(suggest.error)}</div>}
                    </div>
                    <button
                      type="button"
                      className="suggest-item suggest-create"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSuggestOpen(false)}
                    >
                      + Создать нового: «{draft.artist.trim()}»
                    </button>
                  </div>
                )}
              </div>
              {draft.artistUuid && draft.artistName && !existing && (
                <span className="hint artist-binding">
                  Зальётся в карточку «{draft.artistName}» · <span className="mono">{shortId(draft.artistUuid)}</span>
                  <button
                    type="button"
                    className="link-muted"
                    title="Выбрать артиста заново"
                    onClick={() => updateDraft({ artistUuid: undefined, artistName: undefined })}
                  >
                    сбросить ×
                  </button>
                </span>
              )}
            </div>

            <div className="hint">
              Названия, порядок и статусы публикации сохраняются в браузере: после перезагрузки черновик вернётся, файлы
              попросит выбрать заново.
            </div>
            <div className="note">{typeNote}</div>

            <div className="stack" style={{ borderTop: '1px solid var(--card-line)', paddingTop: 14 }}>
              <div className="section-head" style={{ alignItems: 'center', paddingBottom: 10 }}>
                <div className="label">
                  Треки
                  {draft.tracks.length > 0 && (
                    <span className="tag muted" style={{ marginLeft: 8 }}>
                      {draft.tracks.length}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  className="btn sm"
                  disabled={!ready || locked}
                  onClick={addAll}
                  title="Все разобранные файлы из очереди — в черновик, по номеру трека из тегов"
                >
                  {addAllLabel}
                </button>
              </div>
              {draft.tracks.map((t, i) => {
                const label = phaseLabel(t);
                const created = !!t.trackUuid;
                const fileNote = t.file?.name || storedName(t.expectKey) || 'файл не прикреплён';
                return (
                  <div key={t.id}>
                    <div
                      className={`d-row${dropIdx === i && dragIdx !== i ? ' drop-target' : ''}${!t.file && trackNeedsFile(t) ? ' missing' : ''}`}
                      draggable={!locked}
                      onDragStart={() => setDragIdx(i)}
                      onDragOver={(e) => {
                        if (dragIdx === null) return;
                        e.preventDefault();
                        setDropIdx(i);
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        onRowDrop(i);
                      }}
                      onDragEnd={() => {
                        setDragIdx(null);
                        setDropIdx(null);
                      }}
                    >
                      <span className="d-num">{pad2((existing?.basePosition ?? 0) + i + 1)}</span>
                      <div className="d-title">
                        <input
                          className="input track-title"
                          value={t.title}
                          placeholder="Название трека"
                          disabled={created || draft.publishing}
                          onChange={(e) => updateTrack(t.id, { title: e.target.value })}
                          aria-label={`Название трека ${i + 1}`}
                          aria-invalid={!t.title.trim()}
                        />
                        <span className={`hint d-file${!t.file && trackNeedsFile(t) ? ' c-warn' : ''}`} title={fileNote}>
                          файл: {fileNote}
                        </span>
                      </div>
                      <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--text-4)', textAlign: 'right' }}>{fmtDuration(t.meta.durationMs)}</span>
                      <button
                        type="button"
                        className={`flag${t.explicit ? ' on' : ''}`}
                        disabled={created || draft.publishing}
                        title={t.meta.explicitSource ? `из тегов: ${t.meta.explicitSource}` : 'Метка 18+'}
                        onClick={() => updateTrack(t.id, { explicit: !t.explicit })}
                      >
                        {t.explicit ? '18+' : '—'}
                      </button>
                      <span style={{ display: 'flex', gap: 4, flex: 'none' }}>
                        {/* Порядок с клавиатуры: дублирует перетаскивание строки */}
                        <button
                          type="button"
                          className="btn xs"
                          title="Поднять трек"
                          aria-label={`Поднять трек ${i + 1}`}
                          disabled={locked || i === 0}
                          onClick={() => moveTrack(i, i - 1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn xs"
                          title="Опустить трек"
                          aria-label={`Опустить трек ${i + 1}`}
                          disabled={locked || i === draft.tracks.length - 1}
                          onClick={() => moveTrack(i, i + 1)}
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Вернуть в очередь"
                          disabled={created || draft.publishing}
                          onClick={() => returnToQueue(t.id)}
                        >
                          ×
                        </button>
                      </span>
                    </div>
                    {label && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '4px 0 8px 38px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                          <span className={`stage${t.phase === 'error' ? ' c-err' : t.phase === 'uploaded' || t.phase === 'done' ? ' c-ok' : ''}`}>{label}</span>
                          {t.trackUuid && <span className="hint">{shortId(t.trackUuid)}</span>}
                        </div>
                        {(t.phase === 'upload' || t.phase === 'index') && (
                          <div className="bar">
                            <div style={{ width: `${t.phase === 'index' ? 4 : Math.max(4, t.progress * 100)}%`, background: 'var(--accent)' }} />
                          </div>
                        )}
                        {t.error && <span style={{ font: '400 11px/1.4 var(--mono)', color: 'var(--accent-text)' }}>{t.error}</span>}
                      </div>
                    )}
                  </div>
                );
              })}
              {!draft.tracks.length && (
                <div className="empty" style={{ padding: '18px 0' }}>
                  Треков нет. Дождись разбора тегов и добавь их кнопкой сверху.
                </div>
              )}
            </div>

            <ErrorLine error={draft.error} />
            {untitled > 0 && !draft.publishing && (
              <div className="hint c-warn">Введи название для всех треков — без названия: {untitled}</div>
            )}
            {lostTracks > 0 && !draft.publishing && (
              <div className="hint c-warn">
                Файлов ждут повторного выбора: {lostTracks} — нажми «Прикрепить файлы» наверху; публикация без них не начнётся.
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ font: '400 11.5px/1.5 var(--mono)', color: 'var(--text-4)' }}>
                {draft.tracks.length} тр · {fmtDuration(totalMs)}
                {probing > 0 ? ` · ${probing} обрабатывается` : ''}
                {draft.albumUuid && ` · альбом ${shortId(draft.albumUuid)}`}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                {(draft.tracks.length > 0 || draft.title || existing) && (
                  <button type="button" className="btn" disabled={draft.publishing} onClick={reset}>
                    Сбросить
                  </button>
                )}
                <button type="button" className="btn-accent lg" disabled={!canPublish} onClick={publish}>
                  {draft.publishing ? 'Публикация…' : resumable ? 'Продолжить' : existing ? 'Добавить' : 'Опубликовать релиз'}
                </button>
              </div>
            </div>
            {draft.tracks.length > 0 && !draft.publishing && (
              <div className="hint">
                Треки создаются через POST /catalog/tracks, файлы — POST /catalog/tracks/{'{id}'}/file. После
                создания трека название и метку 18+ уже не изменить: в API v1 нет обновления.
              </div>
            )}
          </div>
        </div>
      </div>
      {confirmNode}
    </>
  );
}

