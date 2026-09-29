import { ApiError, rawRequest, request, uploadForm } from './http';
import type {
  AddAlbumRequest,
  AddTrackRequest,
  AdminHealth,
  AdminLogsPage,
  AdminModerationPage,
  AdminSession,
  AdminUsersPage,
  Album,
  AlbumTrackInput,
  Artist,
  AuthRequest,
  AuthResponse,
  LightAlbum,
  LightTrack,
  ModerationFilter,
  Page,
  RegisterRequest,
  Track,
  TrackDetails,
  TrackFileResponse,
  TrackPath,
} from './types';

const enc = encodeURIComponent;

// ---------- auth ----------

export const auth = {
  login: (body: AuthRequest) => request<AuthResponse>('POST', '/login', { body, auth: false }),
  register: (body: RegisterRequest) => request<AuthResponse>('POST', '/register', { body, auth: false }),
  logout: (refresh_token: string) => request<void>('POST', '/logout', { body: { refresh_token } }),
};

// ---------- catalog ----------

export const catalog = {
  searchTracks: (track_name: string, page: Page = {}) =>
    request<Track[]>('GET', '/catalog/tracks/search', { query: { track_name, ...page } }),
  getTrack: (id: string) => request<TrackPath>('GET', `/catalog/tracks/${enc(id)}`),
  trackExists: (id: string) => request<{ exists: boolean }>('GET', `/catalog/tracks/${enc(id)}/exists`),
  addTrack: (body: AddTrackRequest) => request<TrackDetails>('POST', '/catalog/tracks', { body }),
  // Удаляет трек, его позицию в трек-листе и вхождения в плейлисты, плюс файл
  // из хранилища. Обложка остаётся: её файл принадлежит альбому.
  deleteTrack: (id: string) => request<void>('DELETE', `/catalog/tracks/${enc(id)}`),
  // Удаляет альбом вместе со всеми его треками (позиции, плейлисты, файлы
  // треков и обложка). Артист остаётся.
  deleteAlbum: (id: string) => request<void>('DELETE', `/catalog/albums/${enc(id)}`),
  uploadTrackFile: (id: string, file: File, onProgress: (f: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return uploadForm<TrackFileResponse>(`/catalog/tracks/${enc(id)}/file`, form, onProgress, signal);
  },
  // Обложки: путь генерирует сервер, формат — jpg/jpeg/png/webp/gif. Обложка
  // трека становится обложкой его альбома и всех треков (SetTrackCover/SetAlbumCover).
  uploadTrackCover: (id: string, file: File, onProgress: (f: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return uploadForm<TrackFileResponse>(`/catalog/tracks/${enc(id)}/cover`, form, onProgress, signal);
  },
  uploadAlbumCover: (id: string, file: File, onProgress: (f: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('file', file, file.name);
    return uploadForm<TrackFileResponse>(`/catalog/albums/${enc(id)}/cover`, form, onProgress, signal);
  },

  searchArtists: (artist_name: string, page: Page = {}) =>
    request<Artist[]>('GET', '/catalog/artists/search', { query: { artist_name, ...page } }),
  getArtist: (id: string) => request<Artist>('GET', `/catalog/artists/${enc(id)}`),
  getArtistAlbums: (id: string, page: Page = {}) =>
    request<LightAlbum[]>('GET', `/catalog/artists/${enc(id)}/albums`, { query: { ...page } }),
  getArtistTracks: (id: string, page: Page = {}) =>
    request<LightTrack[]>('GET', `/catalog/artists/${enc(id)}/tracks`, { query: { ...page } }),
  addArtist: (artist_name: string) => request<Artist>('POST', '/catalog/artists', { body: { artist_name } }),

  getAlbum: (id: string) => request<Album>('GET', `/catalog/albums/${enc(id)}`),
  getAlbumTracks: (id: string) => request<LightTrack[]>('GET', `/catalog/albums/${enc(id)}/tracks`),
  addAlbum: (body: AddAlbumRequest) => request<Album>('POST', '/catalog/albums', { body }),
  addTracksToAlbum: (id: string, tracks: AlbumTrackInput[]) =>
    request<void>('POST', `/catalog/albums/${enc(id)}/tracks`, { body: { tracks } }),
};

// ---------- admin: только владелец узла (gateway отвечает 403 остальным) ----------

export const admin = {
  health: () => request<AdminHealth>('GET', '/admin/health', { silent: true }),
  // Журнал узла: gateway + user_service + catalog_service, новые первыми.
  logs: (limit = 200, service?: string, level?: string) =>
    request<AdminLogsPage>('GET', '/admin/logs', { query: { limit, service, level }, silent: true }),

  // Сессии пользователя (user_uuid обязателен): список и отзыв по хэшам токенов.
  sessions: (user: string) => request<{ sessions: AdminSession[] }>('GET', '/admin/sessions', { query: { user } }),
  revokeSession: (user: string, session_id: string) =>
    request<void>('DELETE', `/admin/sessions/${enc(session_id)}`, { query: { user } }),
  revokeOthers: (user: string, keep_session_id: string) =>
    request<void>('POST', '/admin/sessions/revoke-others', { body: { user, keep_session_id } }),

  users: (page: Page = {}) => request<AdminUsersPage>('GET', '/admin/users', { query: { ...page } }),
  // Блокировка сразу отзывает все сессии аккаунта и не пускает его во вход.
  setUserBlocked: (id: string, blocked: boolean) =>
    request<void>('PATCH', `/admin/users/${enc(id)}`, { body: { blocked } }),

  moderation: (opts: { explicit?: ModerationFilter; limit?: number; offset?: number } = {}) =>
    request<AdminModerationPage>('GET', '/admin/moderation', {
      query: { explicit: opts.explicit, limit: opts.limit, offset: opts.offset },
    }),
  setExplicit: (id: string, explicit: boolean) =>
    request<void>('PATCH', `/admin/moderation/${enc(id)}`, { body: { explicit } }),
};

// ---------- stream ----------

export const stream = {
  // <audio src> не умеет слать Authorization, поэтому для превью забираем blob.
  blob: async (id: string, signal?: AbortSignal) => {

    const res = await rawRequest('GET', `/stream/${enc(id)}`, { signal });
    if (!res.ok) {
      const msg = (await res.text().catch(() => '')).trim();
      throw new ApiError(res.status, res.status === 403 ? 'explicit-контент заблокирован для этого аккаунта' : msg || res.statusText);
    }
    return res.blob();
  },
};
