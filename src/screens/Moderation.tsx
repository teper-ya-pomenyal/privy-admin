import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { admin } from '../api/endpoints';
import { errorLabel } from '../api/http';
import type { ModerationFilter } from '../api/types';
import { Chip, ErrorLine, ScreenHeader, SkeletonRows } from '../components/ui';
import { fmtDuration, plural } from '../lib/format';
import { useToast } from '../state/toast';

const FILTERS: { key: ModerationFilter; label: string }[] = [
  { key: 'explicit', label: '18+' },
  { key: 'clean', label: 'Без метки' },
  { key: 'all', label: 'Все' },
];
const PAGE = 100;

export function Moderation() {
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ModerationFilter>('explicit');

  // Список с сервера постранично: метка меняется PATCH-ем и сразу видна здесь.
  const pages = useInfiniteQuery({
    queryKey: ['admin-moderation', filter],
    queryFn: ({ pageParam }: { pageParam: number }) => admin.moderation({ explicit: filter, limit: PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.tracks.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const rows = pages.data?.pages.flatMap((p) => p.tracks) ?? [];
  const total = pages.data?.pages.at(-1)?.total ?? 0;

  const setExplicit = useMutation({
    mutationFn: ({ id, explicit }: { id: string; explicit: boolean }) => admin.setExplicit(id, explicit),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-moderation'] }),
    onError: (e) => toast(`Метка 18+ · ${errorLabel(e)}`),
  });

  return (
    <>
      <ScreenHeader
        code="06 · Метки"
        title="Метки 18+"
        sub="Метка ограничивает показ трека аккаунтам младше 18 лет (streaming_service отвечает 403). Изменение вступает в силу сразу и для этого списка, и для каталога."
      />
      <div className="stack gap-14">
        <div className="toolbar">
          {FILTERS.map((f) => (
            <Chip key={f.key} on={filter === f.key} onClick={() => setFilter(f.key)}>
              {f.label}
            </Chip>
          ))}
          <span className="hint" style={{ marginLeft: 'auto' }}>
            по фильтру: {total} {plural(total, ['трек', 'трека', 'треков'])}
          </span>
        </div>
        <ErrorLine error={pages.error} onRetry={() => pages.refetch()} />
        <div className="list">
          {pages.isPending && <SkeletonRows count={4} cover={false} />}
          {rows.map((t) => (
            <div className="wrap-row" key={t.track_uuid}>
              <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: '600 14px/1.2 var(--sans)' }}>{t.track_name}</span>
                <span style={{ font: '400 12px/1.35 var(--sans)', color: 'var(--text-3)' }}>
                  {t.artist_name} · {t.album_name} · {fmtDuration(t.duration_ms)}
                </span>
              </div>
              <div style={{ flex: '0 0 150px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ font: '600 11px/1.3 var(--sans)', letterSpacing: '.06em', color: 'var(--text-4)' }}>Флаг explicit</span>
                <span style={{ font: '400 12px/1.4 var(--sans)', color: 'var(--text-5)' }}>
                  {setExplicit.isPending ? 'сохранение…' : 'меняется здесь и сразу'}
                </span>
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', gap: 12, alignItems: 'center' }}>
                <span className={`tag ${t.explicit ? 'explicit' : 'muted'}`}>{t.explicit ? '18+' : 'Без метки'}</span>
                <button
                  type="button"
                  className="btn sm"
                  disabled={setExplicit.isPending}
                  onClick={() => setExplicit.mutate({ id: t.track_uuid, explicit: !t.explicit })}
                >
                  {t.explicit ? 'Снять метку' : 'Поставить 18+'}
                </button>
                <button type="button" className="link-muted" onClick={() => navigate(`/catalog/${t.album_uuid}`)}>
                  Релиз →
                </button>
              </div>
            </div>
          ))}
          {pages.data && !rows.length && <div className="empty">Нет треков по фильтру.</div>}
        </div>
        {rows.length > 0 && (
          <div className="row-foot">
            <span>
              Показано {rows.length} из {total}
            </span>
            {pages.hasNextPage && (
              <button type="button" className="link" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>
                Показать ещё {Math.min(PAGE, total - rows.length)}
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
