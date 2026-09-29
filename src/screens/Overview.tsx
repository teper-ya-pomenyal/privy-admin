import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AdminServiceHealth, AdminServiceStatus } from '../api/health';
import { ErrorLine, ScreenHeader } from '../components/ui';
import { fmtClock, plural } from '../lib/format';
import { useCatalogIndex, useHealth, useRequestLog } from '../state/queries';
import { missingFileCount, useReleases } from '../state/releases';

const STATUS_CLASS: Record<AdminServiceStatus, string> = { UP: 'ok', DOWN: 'err' };
const STATUS_COLOR: Record<AdminServiceStatus, string> = { UP: 'var(--ok)', DOWN: 'var(--err)' };

// Данные устарели, если gateway не отвечал дольше трёх интервалов опроса.
const STALE_MS = 30_000;

function useNow(ms = 5000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

function ServiceCard({ s }: { s: AdminServiceHealth }) {
  return (
    <div className="svc-card" style={{ cursor: 'default', textAlign: 'left' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span className="svc-name">{s.name}</span>
        <span className={`tag ${STATUS_CLASS[s.status]}`}>{s.status}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, font: '400 11px/1.2 var(--mono)', color: 'var(--text-4)' }}>
        <span>
          {s.postgres === true && <span style={{ color: STATUS_COLOR.UP }}>postgres</span>}
          {s.postgres === false && <span style={{ color: STATUS_COLOR.DOWN }}>postgres ✕</span>}
          {s.postgres !== undefined && s.redis !== undefined && ' · '}
          {s.redis === true && <span style={{ color: STATUS_COLOR.UP }}>redis</span>}
          {s.redis === false && <span style={{ color: STATUS_COLOR.DOWN }}>redis ✕</span>}
        </span>
        <span style={{ color: 'var(--text-3)' }}>{s.ms ? `${s.ms} ms` : '—'}</span>
      </div>
      <div className="hint" style={{ lineHeight: 1.3 }}>
        {s.note || '—'}
      </div>
    </div>
  );
}

interface ActionRow {
  key: string;
  t: string;
  lvl: string;
  text: string;
  to: string;
}

export function Overview() {
  const navigate = useNavigate();
  const catalog = useCatalogIndex();
  const health = useHealth();
  const releases = useReleases();
  const log = useRequestLog();
  const now = useNow();

  const idx = catalog.data;
  const inQueue = releases.queue.length;
  const probing = releases.queue.filter((q) => q.stage === 'PROBE').length;
  const ready = releases.queue.filter((q) => q.stage === 'READY').length;
  const inDraft = releases.draft.tracks.length;
  const missing = missingFileCount(releases);
  const resumable = !releases.draft.publishing && (!!releases.draft.albumUuid || releases.draft.tracks.some((t) => t.trackUuid));
  const broken = releases.queue.filter((q) => q.stage === 'ERROR').length;
  const lostCover = !!releases.draft.coverLost && !releases.draft.cover;

  // «Требует действия» — каждый пункт ведёт прямо к исправлению
  const actions: ActionRow[] = [
    ...(resumable
      ? [{ key: 'resume', t: '', lvl: 'WARN', text: `Публикация не завершена · ${inDraft} ${plural(inDraft, ['трек', 'трека', 'треков'])} в черновике`, to: '/releases' }]
      : []),
    ...(missing
      ? [{ key: 'missing', t: '', lvl: 'WARN', text: `Файлов ждут повторного выбора: ${missing} — черновик пережил перезагрузку`, to: '/releases' }]
      : []),
    ...(broken ? [{ key: 'broken', t: '', lvl: 'ERROR', text: `Файлов с ошибкой разбора: ${broken}`, to: '/releases' }] : []),
    ...(lostCover ? [{ key: 'cover', t: '', lvl: 'WARN', text: 'Обложка черновика не прикреплена — выбери файл заново', to: '/releases' }] : []),
    ...(health.data?.services ?? [])
      .filter((s) => s.status === 'DOWN')
      .map((s) => ({
        key: `svc-${s.name}`,
        t: health.dataUpdatedAt ? fmtClock(new Date(health.dataUpdatedAt)) : '',
        lvl: 'ERROR',
        text: `${s.name} · ${s.note || 'нет ответа'}`,
        to: '/logs',
      })),
    ...log
      .filter((l) => l.level !== 'INFO')
      .slice(0, 5)
      .map((l) => ({ key: `log-${l.id}`, t: fmtClock(l.at), lvl: l.level, text: `${l.service} · ${l.method} ${l.path} · ${l.code}`, to: '/logs' })),
  ].slice(0, 6);

  const counters = [
    {
      label: 'Релизов',
      value: idx ? idx.albums.length : '…',
      sub: idx ? `${idx.trackCount} ${plural(idx.trackCount, ['трек', 'трека', 'треков'])}` : 'загрузка каталога',
      to: '/catalog',
    },
    { label: 'Исполнителей', value: idx ? idx.artists.length : '…', sub: 'в каталоге узла', to: '/catalog' },
    { label: 'Треков 18+', value: idx ? idx.explicitCount : '…', sub: 'помечено в каталоге — менять на экране «Метки»', to: '/moderation' },
    { label: 'В загрузке', value: inQueue + inDraft, sub: `${inDraft} в черновике`, to: '/releases' },
  ];

  const lastCheck = health.dataUpdatedAt ? new Date(health.dataUpdatedAt) : null;
  const stale = lastCheck !== null && now - lastCheck.getTime() > STALE_MS;
  const services = health.data?.services ?? [];
  const upCount = services.filter((s) => s.status === 'UP').length;

  const uploadLabel = probing
    ? `Разбор тегов: ${probing} ${plural(probing, ['файл', 'файла', 'файлов'])} в работе`
    : ready
      ? `Очередь: ${ready} ${plural(ready, ['файл ждёт', 'файла ждут', 'файлов ждут'])} релиза`
      : inDraft
        ? `Черновик: ${inDraft} ${plural(inDraft, ['трек', 'трека', 'треков'])} до публикации`
        : 'Очередь пуста — можно заливать новый релиз';
  const readyShare = inQueue + inDraft ? (ready + inDraft) / (inQueue + inDraft) : 0;

  return (
    <>
      <ScreenHeader
        code="01 · Обзор"
        title="Обзор"
        sub="Что требует действия, сколько контента на узле и в каком он состоянии."
      />
      <div className="stack gap-30">
        <ErrorLine error={catalog.error} onRetry={() => catalog.refetch()} />

        <div className="section">
          <div className="section-head">
            <div className="label">Требует действия</div>
            {actions.length > 0 && (
              <button type="button" className="link" onClick={() => navigate(actions[0].to)}>
                К первому пункту →
              </button>
            )}
          </div>
          <div className="stack">
            {actions.length ? (
              actions.map((a) => (
                <button type="button" key={a.key} className="alert-row" onClick={() => navigate(a.to)}>
                  <span className="mono c-dim" style={{ flex: 'none', fontSize: 11.5 }}>
                    {a.t || '—'}
                  </span>
                  <span
                    className="mono"
                    style={{ width: 42, flex: 'none', fontSize: 11, fontWeight: 600, color: a.lvl === 'ERROR' ? 'var(--err)' : 'var(--warn)' }}
                  >
                    {a.lvl}
                  </span>
                  <span style={{ color: 'var(--text-3)', minWidth: 0, overflowWrap: 'anywhere', textAlign: 'left' }}>{a.text}</span>
                  <span className="link" style={{ flex: 'none' }}>
                    Исправить →
                  </span>
                </button>
              ))
            ) : (
              <div className="empty">Всё спокойно: незавершённых публикаций и недоступных сервисов нет.</div>
            )}
          </div>
        </div>

        <div className="counters">
          {counters.map((c) => (
            <button type="button" key={c.label} className="counter" onClick={() => navigate(c.to)} title={c.sub}>
              <div className="label-sm">{c.label}</div>
              <div className="counter-value">{c.value}</div>
              <div className="hint">{c.sub}</div>
            </button>
          ))}
        </div>

        <div className="section">
          <div className="section-head">
            <div className="label">Доступность сервисов узла</div>
            <div className="hint">
              {health.data
                ? stale
                  ? `данные устарели · последняя проверка ${fmtClock(lastCheck!)}`
                  : `${upCount} из ${services.length} в порядке · проверено gateway ${fmtClock(lastCheck!)} · повтор каждые 10 с`
                : health.isError
                  ? 'gateway не ответил на проверку'
                  : 'нет данных — идёт первая проверка…'}
            </div>
          </div>
          <ErrorLine error={health.error} onRetry={() => health.refetch()} />
          <div className="svc-grid">
            {health.data
              ? services.map((s) => <ServiceCard key={s.name} s={s} />)
              : Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 92 }} />)}
          </div>
          <div className="hint">
            {/* Серверная картина от gateway: postgres и redis пингуют сами сервисы, streaming и хранилище проверяет gateway */}
            Проверка со стороны узла: user_service пингует postgres и redis (сессии), catalog_service — postgres, gateway проверяет streaming_service
            пробным запросом и хранилище треков. Журнал событий — на экране «Запросы», источник «Узел».
          </div>
        </div>

        <div className="bottom-grid">
          <div className="section">
            <div className="label">Загрузка · файлы этой вкладки</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ font: '700 26px/1 var(--sans)' }}>
                {inQueue + inDraft} {plural(inQueue + inDraft, ['файл', 'файла', 'файлов'])}
              </span>
              <span className="hint">в этой вкладке</span>
            </div>
            <div style={{ height: 6, background: 'var(--line)', display: 'flex' }}>
              <div style={{ width: `${readyShare * 100}%`, background: 'var(--text)', transition: 'width .4s' }} />
            </div>
            <button type="button" className="open-row" onClick={() => navigate('/releases')}>
              <span>{uploadLabel}</span>
              <span className="link">Открыть →</span>
            </button>
          </div>
          <div className="section">
            <div className="section-head">
              <div className="label">Запросы этой вкладки · предупреждения</div>
              <button type="button" className="link" onClick={() => navigate('/logs')}>
                Все запросы →
              </button>
            </div>
            <div className="stack">
              {log.filter((l) => l.level !== 'INFO').length ? (
                log
                  .filter((l) => l.level !== 'INFO')
                  .slice(0, 5)
                  .map((l) => (
                    <div key={l.id} className="alert-row">
                      <span className="mono c-dim" style={{ flex: 'none', fontSize: 11.5 }}>
                        {fmtClock(l.at)}
                      </span>
                      <span
                        className="mono"
                        style={{ width: 42, flex: 'none', fontSize: 11, fontWeight: 600, color: l.level === 'ERROR' ? 'var(--err)' : 'var(--warn)' }}
                      >
                        {l.level}
                      </span>
                      <span style={{ color: 'var(--text-3)', minWidth: 0, overflowWrap: 'anywhere' }}>
                        {l.service} · {l.method} {l.path} · {l.code}
                      </span>
                    </div>
                  ))
              ) : (
                <div className="empty">Ошибок в запросах этой вкладки нет. События узла — в «Запросах», источник «Узел».</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
