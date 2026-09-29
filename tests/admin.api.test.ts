import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { admin } from '../src/api/endpoints';
import { setSession } from '../src/api/session';

// Контракт админ-эндпоинтов gateway (/admin/*): какие пути и тела ждут экраны.
const session = { userUuid: 'u-1', userName: 'owner', birthDate: '1990-01-01', accessToken: 'access', refreshToken: 'refresh', role: 'owner' };
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); setSession(null); });
afterAll(() => server.close());
beforeEach(() => setSession(session));

it('health is a silent GET that returns services as reported by the node', async () => {
  server.use(http.get('*/admin/health', ({ request }) => {
    expect(request.headers.get('Authorization')).toBe('Bearer access');
    const url = new URL(request.url);
    return HttpResponse.json({
      checked_at: '2026-09-29T12:00:00Z',
      services: [{ name: 'user_service', status: 'UP', ms: 3, note: 'postgres ok · redis ok', postgres: true, redis: true }],
    });
  }));
  const res = await admin.health();
  expect(res.services[0]).toMatchObject({ name: 'user_service', status: 'UP', postgres: true, redis: true });
});

it('sessions list and revoke go to /admin/sessions with the user query', async () => {
  server.use(
    http.get('*/admin/sessions', ({ request }) => {
      expect(new URL(request.url).searchParams.get('user')).toBe('u-1');
      return HttpResponse.json({ sessions: [{ session_id: 'a'.repeat(64), created_at: 1000, expires_at: 2000 }] });
    }),
    http.delete('*/admin/sessions/:id', ({ request, params }) => {
      expect(params.id).toBe('a'.repeat(64));
      expect(new URL(request.url).searchParams.get('user')).toBe('u-1');
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const list = await admin.sessions('u-1');
  expect(list.sessions).toHaveLength(1);
  await admin.revokeSession('u-1', 'a'.repeat(64));
});

it('revoke-others posts user and keep_session_id', async () => {
  server.use(http.post('*/admin/sessions/revoke-others', async ({ request }) => {
    expect(await request.json()).toEqual({ user: 'u-1', keep_session_id: 'b'.repeat(64) });
    return new HttpResponse(null, { status: 204 });
  }));
  await admin.revokeOthers('u-1', 'b'.repeat(64));
});

it('users pagination and blocking use PATCH with { blocked }', async () => {
  server.use(
    http.get('*/admin/users', ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('limit')).toBe('50');
      expect(url.searchParams.get('offset')).toBe('0');
      return HttpResponse.json({ users: [{ user_uuid: 'u-2', user_name: 'ivan', role: 'user', blocked: false, birth_date: '2000-02-01T00:00:00Z', created_at: '2026-09-29T00:00:00Z' }], total: 1 });
    }),
    http.patch('*/admin/users/:id', async ({ request, params }) => {
      expect(params.id).toBe('u-2');
      expect(await request.json()).toEqual({ blocked: true });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  const page = await admin.users({ limit: 50, offset: 0 });
  expect(page.total).toBe(1);
  expect(page.users[0].user_name).toBe('ivan');
  await admin.setUserBlocked('u-2', true);
});

it('moderation list carries the explicit filter and the toggle PATCHes { explicit }', async () => {
  server.use(
    http.get('*/admin/moderation', ({ request }) => {
      const url = new URL(request.url);
      expect(url.searchParams.get('explicit')).toBe('clean');
      return HttpResponse.json({ tracks: [], total: 0 });
    }),
    http.patch('*/admin/moderation/:id', async ({ request, params }) => {
      expect(params.id).toBe('t-1');
      // осознанное explicit:false обязано дойти до сервера, а не потеряться
      expect(await request.json()).toEqual({ explicit: false });
      return new HttpResponse(null, { status: 204 });
    }),
  );
  await admin.moderation({ explicit: 'clean', limit: 100, offset: 0 });
  await admin.setExplicit('t-1', false);
});
