import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { LogService, RequestLogEntry } from '../api/requestLog';
import { Chip, ScreenHeader } from '../components/ui';
import { fmtClock } from '../lib/format';
import { useRequestLog } from '../state/queries';

const SVC: { key: LogService | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Все' },
  { key: 'user_service', label: 'USER' },
  { key: 'catalog_service', label: 'CATALOG' },
  { key: 'streaming_service', label: 'STREAM' },
];
const LVL = [
  { key: 'ALL', label: 'Все уровни' },
  { key: 'WARN', label: 'WARN+' },
  { key: 'ERROR', label: 'ERROR' },
];
const MAX_ROWS = 80;

const lvlColor = (l: string) => (l === 'ERROR' ? 'var(--err)' : l === 'WARN' ? 'var(--warn)' : 'var(--text-5)');
const codeColor = (c: string) => (/^[23]\d\d$/.test(c) ? 'var(--text-5)' : /^5\d\d$|NETWORK/.test(c) ? 'var(--err)' : 'var(--warn)');

export function Logs() {
  const live = useRequestLog();
  const [params, setParams] = useSearchParams();
  const svc = params.get('svc') ?? 'ALL';
  const lvl = params.get('lvl') ?? 'ALL';
  const [frozen, setFrozen] = useState<RequestLogEntry[] | null>(null);
  const source = frozen ?? live;

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v === 'ALL') next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const rows = useMemo(
    () =>
      source
        .filter((l) => svc === 'ALL' || l.service === svc)
        .filter((l) => lvl === 'ALL' || (lvl === 'ERROR' ? l.level === 'ERROR' : l.level !== 'INFO'))
        .slice(0, MAX_ROWS),
    [source, svc, lvl],
  );

  return (
    <>
      <ScreenHeader
        code="07 · Логи"
        title="Логи"
        sub="HTTP-запросы этой админки к Gateway · последние 200. Серверные логи gRPC появятся с эндпоинтом GET /v1/admin/logs/stream."
      />
      <div className="stack gap-14">
        <div className="toolbar" style={{ gap: 8 }}>
          {SVC.map((c) => (
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
          <div style={{ marginLeft: 'auto' }}>
            <Chip on={!frozen} onClick={() => setFrozen(frozen ? null : live)}>
              <span className={`live-dot${frozen ? '' : ' on'}`} />
              {frozen ? 'Пауза' : 'LIVE'}
            </Chip>
          </div>
        </div>
        <div className="log-panel">
          {rows.map((l) => (
            <div className="log-row" key={l.id}>
              <span style={{ color: 'var(--text-5)', flex: 'none' }}>{fmtClock(l.at)}</span>
              <span style={{ flex: '0 0 40px', fontWeight: 600, color: lvlColor(l.level) }}>{l.level}</span>
              <span style={{ flex: '0 0 118px', color: 'var(--text-4)' }}>{l.service}</span>
              <span style={{ flex: '1 1 260px', minWidth: 0, overflowWrap: 'anywhere', color: 'var(--text-2)' }}>
                {l.method} {l.path}
              </span>
              <span style={{ color: codeColor(l.code) }}>{l.code}</span>
              <span style={{ flex: '0 0 50px', textAlign: 'right', color: 'var(--text-5)' }}>{l.ms}ms</span>
            </div>
          ))}
          {!rows.length && <div style={{ padding: '20px 12px', color: 'var(--text-5)' }}>Нет записей по фильтру.</div>}
        </div>
      </div>
    </>
  );
}
