import { useState, type ReactNode } from 'react';
import { errorLabel } from '../api/http';
import { hueOf, initials } from '../lib/format';

export function ScreenHeader({ code, title, sub, aside }: { code: string; title: string; sub: ReactNode; aside?: ReactNode }) {
  return (
    <div className="screen-head">
      <div className="screen-head-text">
        <div className="screen-code">{code}</div>
        <h1 className="screen-h1">{title}</h1>
        <div className="screen-sub">{sub}</div>
      </div>
      {aside}
    </div>
  );
}

export function Chip({ on, onClick, children, filled }: { on?: boolean; filled?: boolean; onClick?: () => void; children: ReactNode }) {
  return (
    <button type="button" className={`chip${on ? ' on' : ''}${filled ? ' filled' : ''}`} onClick={onClick} aria-pressed={on}>
      {children}
    </button>
  );
}

export function ErrorLine({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  if (!error) return null;
  return (
    <div className="error-line" role="alert">
      <span>{typeof error === 'string' ? error : errorLabel(error)}</span>
      {onRetry && (
        <button type="button" className="link" onClick={onRetry}>
          Повторить
        </button>
      )}
    </div>
  );
}

// Обложек в API v1 нет — всегда плейсхолдер из названия.
export function Cover({ seed, size = 44 }: { seed: string; size?: number }) {
  const hue = hueOf(seed);
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: 'none',
        background: `oklch(0.34 0.07 ${hue})`,
        color: `oklch(0.82 0.06 ${hue})`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        font: `700 ${Math.round(size / 3.2)}px/1 var(--sans)`,
        letterSpacing: '.02em',
      }}
      aria-hidden
    >
      {initials(seed)}
    </div>
  );
}

export function SkeletonRows({ count = 5, cover = true }: { count?: number; cover?: boolean }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-row" key={i}>
          {cover && <div className="skeleton" style={{ width: 44, height: 44, flex: 'none' }} />}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="skeleton" style={{ height: 12, width: `${50 + ((i * 17) % 35)}%` }} />
            <div className="skeleton" style={{ height: 8, width: `${30 + ((i * 11) % 25)}%` }} />
          </div>
        </div>
      ))}
    </>
  );
}

export function Unsupported({ title, text, endpoints }: { title: string; text: ReactNode; endpoints: string[] }) {
  return (
    <div className="unsupported">
      <div className="label">Нет в API v1</div>
      <h3>{title}</h3>
      <p>{text}</p>
      <div className="label-sm" style={{ marginTop: 4 }}>
        Нужны эндпоинты gateway
      </div>
      <ul>
        {endpoints.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
  );
}

export function useConfirm() {
  const [req, setReq] = useState<{ title: string; text: string; action: string; resolve: (ok: boolean) => void } | null>(null);
  const confirm = (title: string, text: string, action = 'Подтвердить') =>
    new Promise<boolean>((resolve) => setReq({ title, text, action, resolve }));
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const node = req ? (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <h3>{req.title}</h3>
        <p>{req.text}</p>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={() => close(false)}>
            Отмена
          </button>
          <button type="button" className="btn-danger" onClick={() => close(true)} autoFocus>
            {req.action}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return { confirm, node };
}
