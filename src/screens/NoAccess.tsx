import { ThemeToggle, nodeHost } from '../components/Shell';
import { useAuthActions, useSession } from '../state/auth';

// Аккаунт без роли owner: админка ему ничего не может — запись в каталог
// gateway отвечает 403 (см. gateway/internal/middlewares/owner.go).
export function NoAccess() {
  const session = useSession();
  const { logout } = useAuthActions();

  return (
    <div className="app" style={{ alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <ThemeToggle float />
      <div className="card" style={{ width: '100%', maxWidth: 420 }}>
        <div className="card-head">
          <div className="logo">
            <div className="logo-mark" />
            <div className="logo-text">
              PRIVY<span>/</span>STREAM
            </div>
          </div>
          <div className="admin-badge">ADMIN</div>
        </div>
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="screen-code">Нет прав владельца</div>
          <p style={{ margin: 0, font: '400 13.5px/1.55 var(--sans)', color: 'var(--text-2)' }}>
            Аккаунт <span className="mono">{session?.userName}</span> на узле{' '}
            <span className="mono">{nodeHost()}</span> не имеет роли OWNER. Управление каталогом закрыто на сервере:
            изменение и удаление отвечают 403.
          </p>
          <p className="hint" style={{ margin: 0 }}>
            Владелец — первый аккаунт узла. Если это твой узел и роль потерялась, её можно вернуть только в базе
            (таблица users, колонка role) или перерегистрировав узел заново.
          </p>
          <button type="button" className="btn-accent lg" style={{ alignSelf: 'flex-start' }} onClick={() => void logout().catch(() => {})}>
            Выйти
          </button>
        </div>
      </div>
    </div>
  );
}
