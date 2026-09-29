import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

const ToastCtx = createContext<(msg: string, action?: ToastAction) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const timer = useRef<number>();
  const hide = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback(
    (m: string, action?: ToastAction) => {
      window.clearTimeout(timer.current);
      setToast({ msg: m, action });
      // С действием живём дольше — нужно время его нажать
      timer.current = window.setTimeout(() => setToast(null), action ? 6000 : 2600);
    },
    [],
  );
  const action = toast?.action;
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                hide();
                action.onClick();
              }}
            >
              {action.label} →
            </button>
          )}
        </div>
      )}
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);
