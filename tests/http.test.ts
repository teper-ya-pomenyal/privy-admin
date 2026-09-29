import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { ApiError, errorLabel, request } from '../src/api/http';
import { getSession, setSession } from '../src/api/session';
const session = { userUuid: 'user', userName: 'test', birthDate: '1990-01-01', accessToken: 'access', refreshToken: 'refresh' };
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); setSession(null); });
afterAll(() => server.close());
beforeEach(() => setSession(session));
it('attaches the access token and serializes a JSON body', async () => {
  server.use(http.post('*/catalog/albums', async ({ request }) => {
    expect(request.headers.get('Authorization')).toBe('Bearer access');
    expect(await request.json()).toEqual({ title: 'Release' });
    return HttpResponse.json({ album_uuid: 'a' });
  }));
  expect(await request('POST', '/catalog/albums', { body: { title: 'Release' } })).toEqual({ album_uuid: 'a' });
});
it('clears the session when refresh fails after a 401', async () => {
  server.use(
    http.get('*/catalog/albums', () => new HttpResponse('unauthorized', { status: 401 })),
    http.post('*/refresh', () => new HttpResponse('expired', { status: 401 })),
  );
  await expect(request('GET', '/catalog/albums')).rejects.toMatchObject({ status: 401 });
  expect(getSession()).toBeNull();
});
it('produces a readable label for gateway errors', () => {
  expect(errorLabel(new ApiError(403, 'blocked'))).toBe('403 · blocked');
  expect(errorLabel(new Error('offline'))).toBe('offline');
});
