import { useState, type FormEvent } from 'react';
import { ApiError } from '../api/http';
import { ErrorLine } from '../components/ui';
import { ThemeToggle, nodeHost } from '../components/Shell';
import { useAuthActions } from '../state/auth';

function explain(e: unknown, mode: 'login' | 'register') {
  if (e instanceof ApiError) {
    if (e.status === 401) return '401 · неверный логин или пароль';
    if (e.status === 409) return '409 · пользователь с таким логином уже есть';
    if (e.status === 400) return `400 · ${e.message}`;
    return e.label;
  }
  return mode === 'login' ? 'не удалось войти' : 'не удалось зарегистрироваться';
}

export function Login() {
  const { login, register } = useAuthActions();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [birth, setBirth] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = user.trim() && password.length >= 8 && (mode === 'login' || /^\d{4}-\d{2}-\d{2}$/.test(birth));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'login') await login(user.trim(), password);
      else await register(user.trim(), password, birth);
    } catch (err) {
      setError(explain(err, mode));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="app" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <ThemeToggle float />
      <form className="card" style={{ width: '100%', maxWidth: 380 }} onSubmit={submit}>
        <div className="card-head">
          <div className="logo">
            <div className="logo-mark" />
            <div className="logo-text">
              PRIVY<span>/</span>STREAM
            </div>
          </div>
          <div className="admin-badge">ADMIN</div>
        </div>
        <div className="card-body">
          <div className="stack gap-14" style={{ gap: 8 }}>
            <div className="screen-code">{mode === 'login' ? 'Вход владельца' : 'Регистрация'}</div>
            <div className="hint">
              узел <span className="mono">{nodeHost()}</span>
            </div>
          </div>
          <div className="field">
            <label className="label-sm" htmlFor="login-user">
              Логин
            </label>
            <input id="login-user" className="input mono" autoComplete="username" value={user} onChange={(e) => setUser(e.target.value)} autoFocus />
          </div>
          <div className="field">
            <label className="label-sm" htmlFor="login-pass">
              Пароль
            </label>
            <input
              id="login-pass"
              className="input mono"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === 'register' && <span className="hint">минимум 8 символов</span>}
          </div>
          {mode === 'register' && (
            <div className="field">
              <label className="label-sm" htmlFor="login-birth">
                Дата рождения
              </label>
              <input id="login-birth" className="input mono" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} />
              <span className="hint">по ней считается доступ к трекам 18+</span>
            </div>
          )}
          <ErrorLine error={error} />
          <button type="submit" className="btn-accent lg" disabled={!valid || busy}>
            {busy ? '…' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
          <button
            type="button"
            className="link-muted"
            style={{ alignSelf: 'center' }}
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
          >
            {mode === 'login' ? 'Первый запуск узла? Регистрация' : 'Уже есть аккаунт? Вход'}
          </button>
        </div>
      </form>
    </div>
  );
}
