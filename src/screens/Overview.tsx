import { useNavigate } from 'react-router-dom';
import type { ServiceProbe, SvcStatus } from '../api/health';
import { ErrorLine, ScreenHeader } from '../components/ui';
import { fmtClock, plural } from '../lib/format';
import { useCatalogIndex, useHealth, useRequestLog } from '../state/queries';
import { useReleases } from '../state/releases';

const STATUS_CLASS: Record<SvcStatus, string> = { UP: 'ok', DEGRADED: 'warn', DOWN: 'err' };
const STATUS_COLOR: Record<SvcStatus, string> = { UP: 'var(--ok)', DEGRADED: 'var(--warn)', DOWN: 'var(--err)' };

function ServiceCard({ s, onClick }: { s: ServiceProbe; onClick: () => void }) {
  return (
    <button type="button" className="svc-card" onClick={onClick}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
        <span className="svc-name">{s.name}</span>
        <span className={`tag ${STATUS_CLASS[s.status]}`}>{s.status}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, font: '400 11px/1.2 var(--mono)', color: 'var(--text-4)' }}>
        <span>{s.proto}</span>
        <span style={{ color: 'var(--text-3)' }}>{s.ms === null ? '—' : `${s.ms} ms`}</span>
      </div>
      <div className="bar">
        <div style={{ width: `${Math.round(s.uptime * 100)}%`, background: STATUS_COLOR[s.status] }} />
      </div>
      <div className="hint" style={{ lineHeight: 1.3 }}>
        {s.note} · аптайм {Math.round(s.uptime * 100)}%
      </div>
    </button>
  );
}

export function Overview() {
  const navigate = useNavigate();
  const catalog = useCatalogIndex();
  const health = useHealth();
  const releases = useReleases();
  const log = useRequestLog();

  const idx = catalog.data;
  const inQueue = releases.queue.length;
  const probing = releases.queue.filter((q) => q.stage === 'PROBE').length;
  const ready = releases.queue.filter((q) => q.stage === 'READY').length;
  const inDraft = releases.draft.tracks.length;

  const counters = [
    {
      label: 'Релизов',
      value: idx ? idx.albums.length : '…',
      sub: idx ? `${idx.trackCount} ${plural(idx.trackCount, ['трек', 'трека', 'треков'])}` : 'загрузка каталога',
      to: '/catalog',
    },
    { label: 'Исполнителей', value: idx ? idx.artists.length : '…', sub: 'в каталоге узла', to: '/catalog' },
    { label: 'Треков 18+', value: idx ? idx.explicitCount : '…', sub: 'флаг explicit', to: '/moderation' },
    { label: 'В загрузке', value: inQueue + inDraft, sub: `${inDraft} в черновике`, to: '/releases' },
  ];

  const alerts = [
    ...(health.data ?? [])
      .filter((s) => s.status !== 'UP')
      .map((s) => ({ key: `svc-${s.name}`, t: health.dataUpdatedAt ? fmtClock(new Date(health.dataUpdatedAt)) : '', lvl: s.status === 'DOWN' ? 'ERROR' : 'WARN', text: `${s.name} · ${s.note}` })),
    ...log
      .filter((l) => l.level !== 'INFO')
      .slice(0, 5)
      .map((l) => ({ key: `log-${l.id}`, t: fmtClock(l.at), lvl: l.level, text: `${l.service} · ${l.method} ${l.path} · ${l.code}` })),
  ].slice(0, 5);

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
      <ScreenHeader code="01 · Обзор" title="Состояние узла" sub="Сервисы, каталог и то, что требует внимания." />
      <div className="stack gap-30">
        <ErrorLine error={catalog.error} onRetry={() => catalog.refetch()} />

        <div className="counters">
          {counters.map((c) => (
            <button type="button" key={c.label} className="counter" onClick={() => navigate(c.to)}>
              <div className="label-sm">{c.label}</div>
              <div className="counter-value">{c.value}</div>
              <div className="hint">{c.sub}</div>
            </button>
          ))}
        </div>

        <div className="section">
          <div className="section-head">
            <div className="label">Сервисы · через gateway</div>
            <div className="hint">проверка каждые 10 с · клик → запросы к сервису</div>
          </div>
          <div className="svc-grid">
            {health.data
              ? health.data.map((s) => <ServiceCard key={s.name} s={s} onClick={() => navigate(s.name === 'gateway' ? '/logs' : `/logs?svc=${s.name}`)} />)
              : Array.from({ length: 4 }, (_, i) => <div key={i} className="skeleton" style={{ height: 92 }} />)}
          </div>
          <div className="hint">
            postgres и redis напрямую не видны: их отказ проявится как DOWN у catalog_service / user_service. Для точных метрик нужен GET
            /v1/admin/health.
          </div>
        </div>

        <div className="bottom-grid">
          <div className="section">
            <div className="label">Загрузка</div>
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
              <div className="label">Предупреждения</div>
              <button type="button" className="link" onClick={() => navigate('/logs')}>
                Все логи →
              </button>
            </div>
            <div className="stack">
              {alerts.length ? (
                alerts.map((a) => (
                  <div key={a.key} className="alert-row">
                    <span className="mono c-dim" style={{ flex: 'none', fontSize: 11.5 }}>
                      {a.t}
                    </span>
                    <span className="mono" style={{ width: 42, flex: 'none', fontSize: 11, fontWeight: 600, color: a.lvl === 'ERROR' ? 'var(--err)' : 'var(--warn)' }}>{a.lvl}</span>
                    <span style={{ color: 'var(--text-3)', minWidth: 0, overflowWrap: 'anywhere' }}>{a.text}</span>
                  </div>
                ))
              ) : (
                <div className="empty">Предупреждений нет.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
