import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { LOG_CAPACITY, type LogService, type RequestLogEntry } from '../api/requestLog';
import type { AdminLogEntry } from '../api/types';
import { Chip, ErrorLine, ScreenHeader } from '../components/ui';
import { fmtClock } from '../lib/format';
import { useRequestLog, useServerLogs } from '../state/queries';

const SVC: { key: LogService | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  { key: 'gateway', label: 'GATEWAY' },
  { key: 'user_service', label: 'USER' },
  { key: 'catalog_service', label: 'CATALOG' },
  { key: 'streaming_service', label: 'STREAM' },
];
// Серверный журнал ведут три сервиса; streaming_service в нём не участвует.
const NODE_SVC = SVC.filter((s) => s.key !== 'streaming_service');
const LVL = [
  { key: 'ALL', label: 'Все уровни' },
  { key: 'WARN', label: 'WARN+' },
  { key: 'ERROR', label: 'ERROR' },
];
const PAGE = 80;

const lvlColor = (l: string) => (l === 'ERROR' ? 'var(--err)' : l === 'WARN' ? 'var(--warn)' : 'var(--text-5)');
const codeColor = (c: string) => (/^[23]\d\d$/.test(c) ? 'var(--text-5)' : /^5\d\d$|NETWORK/.test(c) ? 'var(--err)' : 'var(--warn)');

// Единая строка таблицы для обоих источников: журнал вкладки и журнал узла.
interface LogRow {
  id: string;
  at: number;
  level: string;
  service: string;
  method: string;
  path: string;
  code: string;
  ms: number;
  message: string;
}

function rowsFromLive(entries: RequestLogEntry[]): LogRow[] {
  return entries.map((l) => ({ id: String(l.id), at: l.at.getTime(), level: l.level, service: l.service, method: l.method, path: l.path, code: l.code, ms: l.ms, message: l.note ?? '' }));
}

function rowsFromNode(entries: AdminLogEntry[]): LogRow[] {
  return entries.map((e, i) => ({
    id: `n-${e.at}-${i}-${e.path}`,
    at: e.at,
    level: e.level,
    service: e.service,
    method: e.method ?? '',
    path: e.path ?? '',
    code: e.code ?? '',
    ms: e.ms ?? 0,
    message: e.message ?? '',
  }));
}

export function Logs() {
  const live = useRequestLog();
  const [params, setParams] = useSearchParams();
  const src = params.get('src') === 'node' ? 'node' : 'tab';
  const server = useServerLogs(src === 'node');
  const svc = params.get('svc') ?? 'ALL';
  const lvl = params.get('lvl') ?? 'ALL';
  const q = params.get('q') ?? '';
  const [frozen, setFrozen] = useState<RequestLogEntry[] | null>(null);
  const [visible, setVisible] = useState(PAGE);

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'ALL' || v === '' || (k === 'src' && v === 'tab')) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  // Смена фильтра — показ снова с первой страницы
  useEffect(() => setVisible(PAGE), [src, svc, lvl, q]);

  const source: LogRow[] = src === 'node' ? rowsFromNode(server.data?.entries ?? []) : rowsFromLive(frozen ?? live);

  const filtered = useMemo(
    () =>
      source
        .filter((l) => svc === 'ALL' || l.service === svc)
        .filter((l) => lvl === 'ALL' || (lvl === 'ERROR' ? l.level === 'ERROR' : l.level !== 'INFO'))
        .filter((l) => !q || `${l.method} ${l.path} ${l.message}`.toLocaleLowerCase().includes(q.trim().toLocaleLowerCase())),
    [source, svc, lvl, q],
  );
  const rows = filtered.slice(0, visible);
  const svcChips = src === 'node' ? NODE_SVC : SVC;

  return (
    <>
      <ScreenHeader
        code="07 · Диагностика"
        title="Запросы и журнал"
        sub="Источник «Вкладка» — HTTP-запросы этого браузера к gateway (последние 200). Источник «Узел» — журнал сервисов с самого узла: gateway, user_service и catalog_service, обновление каждые 5 с. streaming_service журнала не ведёт — его отказы видны в записях gateway как 5xx на /stream."
      />
      <div className="stack gap-14">
        <div className="toolbar" style={{ gap: 8 }}>
          <Chip on={src === 'tab'} onClick={() => setParam('src', 'tab')}>
            Вкладка
          </Chip>
          <Chip on={src === 'node'} onClick={() => setParam('src', 'node')}>
            Узел
          </Chip>
          <div className="chip-sep" />
          {svcChips.map((c) => (
            <Chip key={c.key} on={svc === c.key} onClick={() => setParam('svc', c.key)}>
              {c.label}
            </Chip>
          ))}
          <div className="chip-sep" />
          {LVL.map((c) => (
            <Chip key={c.key} on={lvl === c.key} onClick={() => setParam('lvl', c.key)}>
              {c.label}
            </Chip>
          ))}
          {src === 'tab' && (
            <div style={{ marginLeft: 'auto' }}>
              <Chip on={!frozen} onClick={() => setFrozen(frozen ? null : live)}>
                <span className={`live-dot${frozen ? '' : ' on'}`} />
                {frozen ? 'Пауза' : 'LIVE'}
              </Chip>
            </div>
          )}
        </div>
        <input
          className="input search"
          placeholder={src === 'node' ? 'поиск по пути или событию: /login,_catalog, panic…' : 'поиск по пути: /catalog, /refresh, 5xx…'}
          value={q}
          onChange={(e) => setParam('q', e.target.value)}
          aria-label="Поиск по журналу"
        />
        {src === 'node' && <ErrorLine error={server.error} onRetry={() => server.refetch()} />}
        <div className="log-panel">
          {rows.map((l) => (
            <div className="log-row" key={l.id} title={l.message || undefined}>
              <span style={{ color: 'var(--text-5)', flex: 'none' }}>{fmtClock(new Date(l.at))}</span>
              <span style={{ flex: '0 0 40px', fontWeight: 600, color: lvlColor(l.level) }}>{l.level}</span>
              <span style={{ flex: '0 0 118px', color: 'var(--text-4)' }}>{l.service}</span>
              <span style={{ flex: '1 1 260px', minWidth: 0, overflowWrap: 'anywhere', color: 'var(--text-2)' }}>
                {l.method ? `${l.method} ` : ''}
                {l.path}
                {l.message ? <span style={{ color: 'var(--text-5)' }}> · {l.message}</span> : null}
              </span>
              <span style={{ color: codeColor(l.code) }}>{l.code || '—'}</span>
              <span style={{ flex: '0 0 50px', textAlign: 'right', color: 'var(--text-5)' }}>{l.ms ? `${l.ms}ms` : '—'}</span>
            </div>
          ))}
          {!filtered.length && (
            <div style={{ padding: '20px 12px', color: 'var(--text-5)' }}>
              {!source.length
                ? src === 'node'
                  ? 'Серверных записей пока нет — буферы сервисов наполняются с момента старта узла (до 500 записей на сервис).'
                  : `Запросов пока нет — буфер накапливается с момента открытия вкладки (вмещает ${LOG_CAPACITY}).`
                : 'Нет записей по фильтру.'}
            </div>
          )}
        </div>
        <div className="row-foot">
          <span>
            Показано {rows.length} из {filtered.length}
            {src === 'tab' && frozen ? ' (на паузе)' : ''} ·{' '}
            {src === 'node' ? `буферы сервисов (опрос ${server.isFetching ? 'идёт' : 'каждые 5 с'})` : `в буфере ${live.length} из ${LOG_CAPACITY}`}
          </span>
          {filtered.length > rows.length && (
            <button type="button" className="link" onClick={() => setVisible((v) => v + PAGE)}>
              Показать ещё {Math.min(PAGE, filtered.length - rows.length)}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
