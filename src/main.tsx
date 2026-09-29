import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ApiError } from './api/http';
import { App } from './App';
import { initTheme } from './state/theme';
import { ToastProvider } from './state/toast';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx повторять бессмысленно; 401 уже обработан refresh-логикой в http.ts.
      retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
      refetchOnWindowFocus: false,
    },
  },
});

// Атрибут темы на <html> до первой отрисовки — без вспышки чужой палитры
initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
