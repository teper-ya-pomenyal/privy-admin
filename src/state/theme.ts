import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

// Тема — как в клиенте (store/settings.ts), но по умолчанию тёмный графит:
// он живёт под data-theme на <html> (см. :root[data-theme='dark'] в styles.css),
// атрибут ставится до первой отрисовки (initTheme в main.tsx + скрипт в
// index.html). Выбор живёт в localStorage рядом с privy.admin.session.

export type Theme = 'light' | 'dark';

const KEY = 'privy.admin.theme';
const listeners = new Set<() => void>();

let current: Theme = load();

function load(): Theme {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark') return raw;
  } catch {
    // приватный режим — работаем с дефолтом, ничего не сохраняем
  }
  return 'dark';
}

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  // Цвет каркаса мобильного браузера — вслед за темой
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#111313' : '#f2efe8');
}

/** Атрибут до первой отрисовки React (вызывается в main.tsx; страховка — скрипт в index.html). */
export function initTheme() {
  apply(current);
}

export function getTheme() {
  return current;
}

export function setTheme(theme: Theme) {
  if (theme === current) return;
  const doc = document as Document & { startViewTransition?: (update: () => void) => unknown };
  // Кросс-фейд всей страницы через View Transitions (Chromium 111+);
  // без API или при reduced-motion — мгновенно.
  const start = doc.startViewTransition;
  if (!start || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    commit(theme);
    return;
  }
  start.call(doc, () => {
    // flushSync: перерисовка попадает в «новый» снимок, а не дёргается после кросс-фейда
    flushSync(() => commit(theme));
  });
}

function commit(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // приватный режим — тема переживёт вкладку, но не перезагрузку
  }
  apply(theme);
  listeners.forEach((l) => l());
}

export function subscribeTheme(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, getTheme);
}
