import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { releaseType, type AlbumEntry, type ReleaseType } from '../api/catalogIndex';
import { errorLabel } from '../api/http';
import { Chip, Cover, ErrorLine, ScreenHeader, SkeletonRows } from '../components/ui';
import { fmtDate, fmtDuration, pad2, shortId } from '../lib/format';
import { usePreview } from '../lib/usePreview';
import { useCatalogIndex } from '../state/queries';
import { useToast } from '../state/toast';

type Filter = 'Все' | ReleaseType | '18+';
const FILTERS: Filter[] = ['Все', 'Альбом', 'EP', 'Сингл', '18+'];

function AlbumDetail({ album, onClose }: { album: AlbumEntry; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const onError = useCallback((e: unknown) => toast(`Превью · ${errorLabel(e)}`), [toast]);
  const preview = usePreview(onError);
  const explicit = album.tracks.filter((t) => t.explicit).length;
  const total = album.tracks.reduce((s, t) => s + t.duration_ms, 0);

  return (
    <div className="card">
      <div className="card-head">
        <span className="label">
          Релиз · <span className="mono">{shortId(album.album_uuid)}</span>
        </span>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="Закрыть">
          ×
        </button>
      </div>
      <div className="card-body" style={{ gap: 14 }}>
        <div className="field">
          <span className="label-sm">Название</span>
          <div className="field-value" style={{ font: '600 15px/1.2 var(--sans)' }}>
            {album.album_name}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10 }}>
          <div className="field">
            <span className="label-sm">Исполнитель</span>
            <div className="field-value">{album.artist_name}</div>
          </div>
          <div className="field">
            <span className="label-sm">Добавлен</span>
            <div className="field-value mono" style={{ fontSize: 12 }}>
              {fmtDate(album.created_at)}
            </div>
          </div>
          <div className="field">
            <span className="label-sm">Тип</span>
            <div className="field-value mono" style={{ fontSize: 12 }}>
              {releaseType(album.tracks.length)}
            </div>
          </div>
        </div>

        <div className="stack" style={{ borderTop: '1px solid var(--card-line)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0 6px' }} className="label-sm">
            <span>
              Треки · {album.tracks.length} · {fmtDuration(total)}
            </span>
            <span>18+ · {explicit}</span>
          </div>
          {album.tracks.map((t, i) => {
            const on = preview.playing === t.track_uuid;
            const busy = preview.loading === t.track_uuid;
            return (
              <div className="t-row" key={t.track_uuid}>
                <span className="d-num">{pad2(i + 1)}</span>
                <button
                  type="button"
                  className={`play${on || busy ? ' on' : ''}`}
                  onClick={() => preview.toggle(t.track_uuid)}
                  title={on ? 'Стоп' : 'Превью через /stream'}
                  aria-label={on ? 'Стоп' : `Прослушать ${t.track_name}`}
                >
                  {busy ? '…' : on ? '■' : '▶'}
                </button>
                <span className="t-title" title={t.track_name}>
                  {t.track_name}
                </span>
                <span style={{ font: '400 11.5px/1 var(--mono)', color: 'var(--text-4)', textAlign: 'right' }}>{fmtDuration(t.duration_ms)}</span>
                <span className={`flag${t.explicit ? ' on' : ''}`}>{t.explicit ? '18+' : '—'}</span>
              </div>
            );
          })}
          {!album.tracks.length && <div className="empty">В релизе нет треков.</div>}
        </div>

        <div className="note">
          В API v1 метаданные и метка 18+ задаются только при создании трека — эндпоинтов изменения (UpdateAlbum, PATCH трека) нет.
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="btn-accent" onClick={() => navigate(`/releases?album=${album.album_uuid}`)}>
            + Добавить треки
          </button>
        </div>
      </div>
    </div>
  );
}

export function Catalog() {
  const { id } = useParams();
  const navigate = useNavigate();
  const catalog = useCatalogIndex();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('Все');

  const albums = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('ru');
    return (catalog.data?.albums ?? []).filter((a) => {
      if (filter === '18+' && !a.tracks.some((t) => t.explicit)) return false;
      if (filter !== 'Все' && filter !== '18+' && releaseType(a.tracks.length) !== filter) return false;
      if (!q) return true;
      return (
        a.album_name.toLocaleLowerCase('ru').includes(q) ||
        a.artist_name.toLocaleLowerCase('ru').includes(q) ||
        a.tracks.some((t) => t.track_name.toLocaleLowerCase('ru').includes(q))
      );
    });
  }, [catalog.data, query, filter]);

  const selected = catalog.data?.albums.find((a) => a.album_uuid === id);

  return (
    <>
      <ScreenHeader code="03 · Каталог" title="Каталог" sub="Релизы и треки узла, метки 18+ на уровне трека." />
      <div className="stack gap-18">
        <div className="toolbar">
          <input
            className="input search"
            placeholder="поиск: релиз, исполнитель, трек"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Поиск по каталогу"
          />
          {FILTERS.map((f) => (
            <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
              {f}
            </Chip>
          ))}
          <button type="button" className="link-muted" style={{ marginLeft: 'auto' }} onClick={() => catalog.refetch()} disabled={catalog.isFetching}>
            {catalog.isFetching ? 'Обновление…' : 'Обновить ↻'}
          </button>
        </div>
        <ErrorLine error={catalog.error} onRetry={() => catalog.refetch()} />
        <div className="two-col catalog">
          <div className="list">
            {catalog.isPending && <SkeletonRows count={6} />}
            {albums.map((a) => {
              const n = a.tracks.length;
              return (
                <button
                  type="button"
                  key={a.album_uuid}
                  className={`album-row${a.album_uuid === id ? ' selected' : ''}`}
                  onClick={() => navigate(a.album_uuid === id ? '/catalog' : `/catalog/${a.album_uuid}`)}
                >
                  <Cover seed={a.album_name} />
                  <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span className="album-title">{a.album_name}</span>
                    <span className="album-meta">
                      {a.artist_name} · {fmtDate(a.created_at).slice(0, 4)} · {releaseType(n)} · {n} тр
                    </span>
                  </div>
                  {a.tracks.some((t) => t.explicit) && <span className="tag explicit">18+</span>}
                </button>
              );
            })}
            {catalog.data && !albums.length && (
              <div className="empty" style={{ padding: '22px 12px' }}>
                {catalog.data.albums.length ? 'Ничего не найдено.' : 'Каталог пуст — загрузи первый релиз.'}
              </div>
            )}
          </div>
          {selected ? (
            <AlbumDetail key={selected.album_uuid} album={selected} onClose={() => navigate('/catalog')} />
          ) : (
            <div className="placeholder-box">
              {id && catalog.data ? 'Релиз не найден в каталоге.' : 'Выбери релиз слева, чтобы посмотреть треки и послушать превью.'}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
