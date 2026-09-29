import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { MemoryRouter, Outlet } from 'react-router-dom';
import { afterAll, afterEach, beforeAll, expect, it, vi } from 'vitest';
import { App } from '../src/App';
import { request } from '../src/api/http';
import { setSession } from '../src/api/session';

vi.mock('../src/components/Shell', () => ({
  Shell: () => <Outlet />,
  ThemeToggle: () => null,
  nodeHost: () => 'test-node',
}));
vi.mock('../src/screens/Access', () => ({ Sessions: () => <div>sessions screen</div>, Users: () => <div>users screen</div> }));
vi.mock('../src/screens/Catalog', () => ({ Catalog: () => <div>catalog screen</div> }));
vi.mock('../src/screens/Logs', () => ({ Logs: () => <div>logs screen</div> }));
vi.mock('../src/screens/Moderation', () => ({ Moderation: () => <div>moderation screen</div> }));
vi.mock('../src/screens/Overview', () => ({ Overview: () => <div>overview screen</div> }));
vi.mock('../src/screens/Releases', () => ({ Releases: () => <div>releases screen</div> }));

const server = setupServer();
const session = { userUuid: 'user', userName: 'test', birthDate: '1990-01-01', accessToken: 'access', refreshToken: 'refresh', role: 'owner' };
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => { server.resetHandlers(); setSession(null); });

it('returns the app to the login screen when an API 401 cannot be refreshed', async () => {
  setSession(session);
  server.use(
    http.get('*/catalog/albums', () => new HttpResponse('unauthorized', { status: 401 })),
    http.post('*/refresh', () => new HttpResponse('expired', { status: 401 })),
  );
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/sessions']}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('sessions screen')).toBeInTheDocument();
  await act(async () => { await expect(request('GET', '/catalog/albums')).rejects.toMatchObject({ status: 401 }); });
  expect(await screen.findByText('Вход владельца')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Войти' })).toBeInTheDocument();
});

it('shows the no-access screen to a session without the owner role', () => {
  setSession({ ...session, role: 'user' });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/']}><App /></MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('Нет прав владельца')).toBeInTheDocument();
  expect(screen.queryByText('overview screen')).not.toBeInTheDocument();
});
