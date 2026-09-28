import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chip, ErrorLine, ScreenHeader, SkeletonRows, Unsupported } from '../components/ui';
import { fmtDuration } from '../lib/format';
import { useCatalogIndex } from '../state/queries';

type Filter = '18+' | 'Без метки' | 'Все';

export function Moderation() {
  const catalog = useCatalogIndex();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('18+');

  const rows = useMemo(
    () =>
      (catalog.data?.albums ?? [])
        .flatMap((a) => a.tracks.map((t) => ({ ...t, album: a })))
        .filter((t) => (filter === 'Все' ? true : filter === '18+' ? t.explicit : !t.explicit)),
    [catalog.data, filter],
  );

  return (
    <>
      <ScreenHeader
        code="06 · Метки"
        title="Метки 18+"
        sub="Метка ничего не скрывает — она лишь ограничивает показ аккаунтам младше 18 лет (streaming_service отвечает 403)."
      />
      <div className="stack gap-30">
        <div className="stack gap-18">
          <div className="toolbar">
            {(['18+', 'Без метки', 'Все'] as Filter[]).map((f) => (
              <Chip key={f} on={filter === f} onClick={() => setFilter(f)}>
                {f}
              </Chip>
            ))}
            <span className="hint" style={{ marginLeft: 'auto' }}>
              {rows.length} тр
            </span>
          </div>
          <ErrorLine error={catalog.error} onRetry={() => catalog.refetch()} />
          <div className="list">
            {catalog.isPending && <SkeletonRows count={4} cover={false} />}
            {rows.slice(0, 300).map((t) => (
              <div className="wrap-row" key={t.track_uuid}>
                <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: '600 14px/1.2 var(--sans)' }}>{t.track_name}</span>
                  <span style={{ font: '400 12px/1.35 var(--sans)', color: 'var(--text-3)' }}>
                    {t.album.artist_name} · {t.album.album_name} · {fmtDuration(t.duration_ms)}
                  </span>
                </div>
                <div style={{ flex: '0 0 150px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ font: '600 11px/1.3 var(--sans)', letterSpacing: '.06em', color: 'var(--text-4)' }}>Флаг explicit</span>
                  <span style={{ font: '400 12px/1.4 var(--sans)', color: 'var(--text-5)' }}>задан при создании трека</span>
                </div>
                <div style={{ flex: '0 0 auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span className={`tag ${t.explicit ? 'explicit' : 'muted'}`}>{t.explicit ? '18+' : 'Без метки'}</span>
                  <button type="button" className="link-muted" onClick={() => navigate(`/catalog/${t.album.album_uuid}`)}>
                    Релиз →
                  </button>
                </div>
              </div>
            ))}
            {catalog.data && !rows.length && <div className="empty">Нет треков по фильтру.</div>}
          </div>
        </div>

        <Unsupported
          title="Очередь модерации"
          text="Флаг explicit в API v1 выставляется только в POST /catalog/tracks (на экране «Релизы» — тумблер 18+ и автоопределение по тегам ITUNESADVISORY / EXPLICIT). Жалоб, очереди и изменения метки у существующего трека нет."
          endpoints={['GET /v1/admin/moderation', 'PATCH /v1/admin/moderation/{id}', 'PATCH /catalog/tracks/{id} · { explicit }']}
        />
      </div>
    </>
  );
}
