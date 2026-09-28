import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE } from '../api/http';
import { overallStatus } from '../api/health';
import { useAuthActions, useSession } from '../state/auth';
import { useCatalogIndex, useHealth, useRequestLog } from '../state/queries';
import { useReleases } from '../state/releases';
import { useToast } from '../state/toast';

export interface NavItem {
  to: string;
  label: string;
  mobile: string;
  count: string;
  hot: boolean;
}

export const nodeHost = () => {
  try {
    return API_BASE ? new URL(API_BASE).host : window.location.host;
  } catch {
    return window.location.host;
  }
};

function useNav(): NavItem[] {
  const releases = useReleases();
  const catalog = useCatalogIndex();
  const log = useRequestLog();
  const queueCount = releases.queue.length + releases.draft.tracks.length;
  const busy = releases.queue.some((q) => q.stage === 'PROBE') || releases.draft.publishing;
  const errors = log.filter((l) => l.level === 'ERROR').length;
  const idx = catalog.data;
  return [
    { to: '/', label: 'Обзор', mobile: 'Обзор', count: '', hot: false },
    { to: '/releases', label: 'Релизы', mobile: 'Релизы', count: queueCount ? String(queueCount) : '', hot: busy },
    { to: '/catalog', label: 'Каталог', mobile: 'Каталог', count: idx ? String(idx.albums.length) : '', hot: false },
    { to: '/users', label: 'Пользователи', mobile: 'Люди', count: '—', hot: false },
    { to: '/sessions', label: 'Сессии', mobile: 'Сессии', count: '1', hot: false },
    { to: '/moderation', label: 'Метки 18+', mobile: 'Метки', count: idx ? String(idx.explicitCount) : '', hot: false },
    { to: '/logs', label: 'Логи', mobile: 'Логи', count: errors ? `${errors} ERR` : '', hot: errors > 0 },
  ];
}

export function Shell() {
  const nav = useNav();
  const session = useSession();
  const health = useHealth();
  const { logout } = useAuthActions();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const overall = overallStatus(health.data);
  const dotClass = overall ? overall.toLowerCase() : '';
  const host = useMemo(nodeHost, []);

  useEffect(() => setMoreOpen(false), [location.pathname]);

  const doLogout = async () => {
    try {
      await logout();
    } catch {
      toast('Сессия закрыта локально · /logout не ответил');
    }
  };

  const isActive = (to: string) => (to === '/' ? location.pathname === '/' : location.pathname.startsWith(to));
  const mobileMain = nav.slice(0, 4);
  const mobileMore = nav.slice(4);
  const moreActive = mobileMore.some((n) => isActive(n.to));

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <div className="logo">
            <div className="logo-mark" />
            <div className="logo-text">
              PRIVY<span>/</span>STREAM
            </div>
          </div>
          <div className="admin-badge">ADMIN</div>
          <div className="node-chip" title={overall ? `Узел: ${overall}` : 'Проверка узла…'}>
            <div className={`dot ${dotClass}`} />
            <span className="node-host">{host}</span>
            <span className="node-role">· OWNER</span>
          </div>
        </div>
        <div className="header-right">
          <span className="user-login">{session?.userName}</span>
          <button type="button" className="btn sm" onClick={doLogout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="m-header">
        <div className="m-header-brand">
          <i />
          ADMIN
        </div>
        <div className="m-header-node">
          <div className={`dot ${dotClass}`} />
          {host}
        </div>
      </div>

      <nav className="tabs" aria-label="Разделы">
        {nav.map((n) => (
          <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive: a }) => `tab${a ? ' active' : ''}`}>
            <span>{n.label}</span>
            {n.count && <span className={`tab-count${n.hot ? ' hot' : ''}`}>{n.count}</span>}
          </NavLink>
        ))}
      </nav>

      <main className="content">
        <div className="content-inner">
          <Outlet />
        </div>
      </main>

      {moreOpen && (
        <div className="m-sheet-backdrop" onClick={() => setMoreOpen(false)}>
          <div className="m-sheet" onClick={(e) => e.stopPropagation()}>
            {mobileMore.map((n) => (
              <button key={n.to} type="button" className="m-sheet-item" onClick={() => navigate(n.to)}>
                <span>{n.label}</span>
                <span className={`tab-count${n.hot ? ' hot' : ''}`}>{n.count}</span>
              </button>
            ))}
            <button type="button" className="m-sheet-item danger" onClick={doLogout}>
              <span>Выйти</span>
              <span className="tab-count">{session?.userName}</span>
            </button>
          </div>
        </div>
      )}
      <nav className="m-nav" aria-label="Разделы">
        {mobileMain.map((n) => (
          <button key={n.to} type="button" className={`m-nav-item${isActive(n.to) ? ' active' : ''}`} onClick={() => navigate(n.to)}>
            <span>{n.mobile}</span>
          </button>
        ))}
        <button type="button" className={`m-nav-item${moreActive || moreOpen ? ' active' : ''}`} onClick={() => setMoreOpen((v) => !v)}>
          <span>Ещё</span>
        </button>
      </nav>
    </div>
  );
}
