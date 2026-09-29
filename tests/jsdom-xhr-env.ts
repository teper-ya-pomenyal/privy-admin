// Кастомное jsdom-окружение для vitest. Отличие от встроенного одно: teardown
// не падает, если при очистке global встречает неконфигурируемое свойство —
// тестовый XMLHttpRequest-шим (tests/setup.ts) специально неконфигурируемый,
// чтобы msw не оборачивал его своим XHR-интерсептором.
import { JSDOM } from 'jsdom';
import { populateGlobal } from 'vitest/environments';

export default {
  transformMode: 'web' as const,
  setup({ global }: { global: Record<string, unknown> }) {
    const dom = new JSDOM('<!DOCTYPE html>', {
      url: 'http://localhost:3000',
      pretendToBeVisual: true,
    });
    const { keys, originals } = populateGlobal(global, dom.window, { bindFunctions: true });
    return {
      teardown(globalToClear: Record<string, unknown>) {
        dom.window.close();
        delete globalToClear.jsdom;
        for (const key of keys) {
          try {
            delete globalToClear[key];
          } catch {
            /* неконфигурируемое — наш XHR-шим, переживёт до пересоздания окружения */
          }
        }
        for (const [k, v] of originals as Map<string, unknown>) globalToClear[k] = v;
      },
    };
  },
};
