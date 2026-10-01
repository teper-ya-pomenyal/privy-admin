import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { errorLabel } from '../api/http';
import { hueOf, initials } from '../lib/format';

// Иконки темы — те же пути и обводка, что в клиенте (ui/index.tsx)
function Ico({ size, d }: { size: number; d: string[] }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
export const SunIcon = ({ size = 16 }: { size?: number }) => (
  <Ico
    size={size}
    d={[
      'M12 8.2a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6Z',
      'M12 2.6v2.2',
      'M12 19.2v2.2',
      'm4.6 4.6 1.6 1.6',
      'm17.8 17.8 1.6 1.6',
      'M2.6 12h2.2',
      'M19.2 12h2.2',
      'm6.2 17.8-1.6 1.6',
      'm19.4 4.6-1.6 1.6',
    ]}
  />
);
export const MoonIcon = ({ size = 16 }: { size?: number }) => <Ico size={size} d={['M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z']} />;
export const UploadIcon = ({ size = 16 }: { size?: number }) => (
  <Ico size={size} d={['M12 15.4V5.2', 'm7.6 9 4.4-4.4L16.4 9', 'M5 15.6v2.6A1.8 1.8 0 0 0 6.8 20h10.4a1.8 1.8 0 0 0 1.8-1.8v-2.6']} />
);
export const TrashIcon = ({ size = 16 }: { size?: number }) => (
  <Ico
    size={size}
    d={['M4.5 7h15', 'M9.5 7V5.6A1.6 1.6 0 0 1 11.1 4h1.8a1.6 1.6 0 0 1 1.6 1.6V7', 'M6.4 7l.8 12.2a1.6 1.6 0 0 0 1.6 1.5h6.4a1.6 1.6 0 0 0 1.6-1.5L17.6 7', 'M10 11v6', 'M14 11v6']}
  />
);

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

// Обложек в API v1 нет — всегда плейсхолдер из названия. Тона берутся из
// переменных темы (--cover-* в styles.css): на светлой — бледная крашеная
// плитка с тёмными чернилами, на тёмной — глубокий тон со светлым текстом.
export function Cover({ seed, size = 44 }: { seed: string; size?: number }) {
  const hue = hueOf(seed);
  return (
    <div
      style={
        {
          '--hue': String(hue),
          width: size,
          height: size,
          flex: 'none',
          background: 'oklch(var(--cover-l) var(--cover-c) var(--hue))',
          color: 'oklch(var(--cover-ink-l) var(--cover-ink-c) var(--hue))',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          font: `700 ${Math.round(size / 3.2)}px/1 var(--sans)`,
          letterSpacing: '.02em',
        } as CSSProperties
      }
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

// Общая механика модальных диалогов: Escape закрывает, Tab не выпускает фокус
// наружу, при размонтировании фокус возвращается на открывшую кнопку.
export function useDialogFocus(boxRef: RefObject<HTMLElement | null>, onClose: () => void) {
  const cbRef = useRef(onClose);
  cbRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const box = boxRef.current;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        cbRef.current();
        return;
      }
      if (e.key !== 'Tab' || !box) return;
      const focusable = Array.from(box.querySelectorAll<HTMLButtonElement>('button')).filter((b) => !b.disabled);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === first || !inside)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !inside)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      opener?.focus?.();
    };
  }, [boxRef]);
}

interface ConfirmRequest {
  title: string;
  text: string;
  action: string;
  resolve: (ok: boolean) => void;
}

// Диалог подтверждения: закрытие по Escape, удержание и возврат фокуса.
function ConfirmDialog({ req, close }: { req: ConfirmRequest; close: (ok: boolean) => void }) {
  const titleId = useId();
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef, () => close(false));
  return (
    <div className="modal-backdrop" onClick={() => close(false)}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={boxRef} onClick={(e) => e.stopPropagation()}>
        <h3 id={titleId}>{req.title}</h3>
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
  );
}

export function useConfirm() {
  const [req, setReq] = useState<ConfirmRequest | null>(null);
  const confirm = (title: string, text: string, action = 'Подтвердить') =>
    new Promise<boolean>((resolve) => setReq({ title, text, action, resolve }));
  const close = (ok: boolean) => {
    req?.resolve(ok);
    setReq(null);
  };
  const node = req ? <ConfirmDialog req={req} close={close} /> : null;
  return { confirm, node };
}
