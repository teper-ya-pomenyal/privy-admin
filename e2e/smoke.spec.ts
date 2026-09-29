import { expect, test } from '@playwright/test';
test('login opens catalog, moderation, and access screens', async ({ page }) => {
  await page.route('**/login', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_uuid: 'user', birth_date: '1990-01-01', access_token: 'access', refresh_token: 'refresh' }) }));
  // Register the catch-all first: later, more specific routes must win.
  await page.route('**/catalog/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/catalog/artists/search?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ artist_uuid: 'artist', artist_name: 'Smoke Artist' }]) }));
  await page.route('**/catalog/artists/artist/albums?*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ album_uuid: 'album', album_name: 'Smoke Album', created_at: '2026-01-01' }]) }));
  await page.route('**/catalog/albums/album/tracks', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ track_uuid: 'track', track_name: 'Smoke Track', explicit: true, duration_ms: 90000 }]) }));
  await page.route('**/health*', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await page.goto('/admin/');
  await page.getByLabel('Логин').fill('owner');
  await page.getByLabel('Пароль').fill('password123');
  await page.getByRole('button', { name: 'Войти' }).click();
  await page.getByRole('navigation', { name: 'Разделы' }).first().getByText('Каталог').click();
  await expect(page.getByText('Smoke Album')).toBeVisible();
  await page.getByRole('navigation', { name: 'Разделы' }).first().getByText('Метки 18+').click();
  await expect(page.getByText('Smoke Track')).toBeVisible();
  await page.getByRole('navigation', { name: 'Разделы' }).first().getByText('Сессии').click();
  await expect(page.getByText('ЭТА СЕССИЯ')).toBeVisible();
});
