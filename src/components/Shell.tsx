import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE } from '../api/http';
import { overallStatus } from '../api/health';
import { useAuthActions, useSession } from '../state/auth';
import { setTheme, useTheme } from '../state/theme';
import { useCatalogIndex, useHealth, useRequestLog } from '../state/queries';
import { useReleases } from '../state/releases';
import { useToast } from '../state/toast';
import { MoonIcon, SunIcon, useDialogFocus } from './ui';

export interface NavItem {
  to: string;
  label: string;
  mobile: string;
  count: string;
  /** Что означает счётчик — уходит в подсказку, чтобы число не читалось как очередь задач. */
  countTitle?: string;
  hot: boolean;
  /** Группа навигации: «Контент», «Доступ», «Диагностика» — подписи между табами. */
  group: 'none' | 'content' | 'access' | 'diag';
}

const GROUP_LABEL: Partial<Record<NavItem['group'], string>> = {
  content: 'Контент',
  access: 'Доступ',
  diag: 'Диагностика',
};
const GROUP_ORDER: NavItem['group'][] = ['none', 'content', 'access', 'diag'];

/** Кнопка луна/солнце — как на экране входа клиента (Auth.tsx); float — в углу экрана. */
export function ThemeToggle({ float = false }: { float?: boolean }) {
  const theme = useTheme();
  return (
    <button
      type="button"
      className={`theme-toggle${float ? ' float' : ''}`}
      aria-label={theme === 'light' ? 'Включить тёмную тему' : 'Включить светлую тему'}
      title={theme === 'light' ? 'Тёмная тема' : 'Светлая тема'}
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    >
      {theme === 'light' ? <MoonIcon size={15} /> : <SunIcon size={15} />}
    </button>
  );
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
    { to: '/', label: 'Обзор', mobile: 'Обзор', count: '', hot: false, group: 'none' },
    { to: '/releases', label: 'Релизы', mobile: 'Релизы', count: queueCount ? String(queueCount) : '', countTitle: 'файлов в очереди и черновике релиза', hot: busy, group: 'content' },
    { to: '/catalog', label: 'Каталог', mobile: 'Каталог', count: idx ? String(idx.albums.length) : '', countTitle: 'релизов в каталоге узла', hot: false, group: 'content' },
    { to: '/moderation', label: 'Метки 18+', mobile: 'Метки', count: idx ? String(idx.explicitCount) : '', countTitle: 'треков уже помечено 18+ — состояние каталога, меняется на экране «Метки»', hot: false, group: 'content' },
    { to: '/users', label: 'Пользователи', mobile: 'Люди', count: '', hot: false, group: 'access' },
    { to: '/sessions', label: 'Сессии', mobile: 'Сессии', count: '', hot: false, group: 'access' },
    { to: '/logs', label: 'Запросы', mobile: 'Запросы', count: errors ? `${errors} ERR` : '', countTitle: 'ошибочных запросов из этой вкладки браузера', hot: errors > 0, group: 'diag' },
  ];
}

/** Мобильная шторка «Ещё» — диалог: Escape закрывает, фокус удерживается и возвращается. */
function MoreSheet({ onClose, label, children }: { onClose: () => void; label: string; children: React.ReactNode }) {
  const boxRef = useRef<HTMLDivElement>(null);
  useDialogFocus(boxRef, onClose);
  useEffect(() => {
    boxRef.current?.querySelector<HTMLElement>('button')?.focus();
  }, []);
  return (
    <div className="m-sheet-backdrop" onClick={onClose}>
      <div className="m-sheet" role="dialog" aria-modal="true" aria-label={label} ref={boxRef} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
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
  const overall = overallStatus(health.data?.services);
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
  // Группы: «Контент», «Доступ», «Диагностика» — подписи между табами на десктопе
  // и заголовки секций в шторке «Ещё» на мобайле.
  const groups = GROUP_ORDER.map((g) => ({ g, items: nav.filter((n) => n.group === g) })).filter((x) => x.items.length);
  const flat = nav;
  const mobileMain = flat.slice(0, 4);
  const mobileMore = flat.slice(4);
  const moreActive = mobileMore.some((n) => isActive(n.to));
  const isOwner = session?.role === 'owner';

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
          <div
            className="node-chip"
            title={overall ? `Доступность из браузера: ${overall} · проверка пробными запросами` : 'Проверка узла…'}
          >
            <div className={`dot ${dotClass}`} />
            <span className="node-host">{host}</span>
            {isOwner && <span className="node-role">· OWNER</span>}
          </div>
        </div>
        <div className="header-right">
          <span className="user-login">{session?.userName}</span>
          <ThemeToggle />
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
        <div className="m-header-right">
          <div className="m-header-node">
            <div className={`dot ${dotClass}`} />
            {host}
          </div>
          <ThemeToggle />
        </div>
      </div>

      <nav className="tabs" aria-label="Разделы">
        {groups.map(({ g, items }, gi) => (
          <span key={g} className="tabs-group" role="group" aria-label={GROUP_LABEL[g] ?? 'Разделы'}>
            {GROUP_LABEL[g] && (
              <span className="tabs-group-mark" aria-hidden>
                {GROUP_LABEL[g]}
              </span>
            )}
            {items.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive: a }) => `tab${a ? ' active' : ''}`} title={n.countTitle}>
                <span>{n.label}</span>
                {n.count && (
                  <span className={`tab-count${n.hot ? ' hot' : ''}`} title={n.countTitle}>
                    {n.count}
                  </span>
                )}
              </NavLink>
            ))}
            {gi < groups.length - 1 && <span className="chip-sep" aria-hidden />}
          </span>
        ))}
      </nav>

      <main className="content">
        <div className="content-inner">
          <Outlet />
        </div>
      </main>

      {moreOpen && (
        <MoreSheet onClose={() => setMoreOpen(false)} label="Ещё разделы">
          {groups.map(({ g, items }) => {
            const moreItems = items.filter((n) => mobileMore.includes(n));
            if (!moreItems.length) return null;
            return (
              <Fragment key={g}>
                {GROUP_LABEL[g] && <div className="m-sheet-caption">{GROUP_LABEL[g]}</div>}
                {moreItems.map((n) => (
                  <button key={n.to} type="button" className="m-sheet-item" onClick={() => navigate(n.to)}>
                    <span>{n.label}</span>
                    <span className={`tab-count${n.hot ? ' hot' : ''}`} title={n.countTitle}>
                      {n.count}
                    </span>
                  </button>
                ))}
              </Fragment>
            );
          })}
          <button type="button" className="m-sheet-item danger" onClick={doLogout}>
            <span>Выйти</span>
            <span className="tab-count">{session?.userName}</span>
          </button>
        </MoreSheet>
      )}
      <nav className="m-nav" aria-label="Разделы">
        {mobileMain.map((n) => (
          <button key={n.to} type="button" className={`m-nav-item${isActive(n.to) ? ' active' : ''}`} onClick={() => navigate(n.to)}>
            <span>{n.mobile}</span>
          </button>
        ))}
        <button type="button" className={`m-nav-item${moreActive || moreOpen ? ' active' : ''}`} aria-haspopup="dialog" aria-expanded={moreOpen} onClick={() => setMoreOpen((v) => !v)}>
          <span>Ещё</span>
        </button>
      </nav>
    </div>
  );
}
