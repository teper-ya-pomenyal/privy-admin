// Схемы из privy_stream/api/v1/openapi.yaml (components/schemas).

export interface RegisterRequest {
  user_name: string;
  password: string;
  birth_date: string; // YYYY-MM-DD
}

export interface AuthRequest {
  user_name: string;
  password: string;
}

export interface AuthResponse {
  user_uuid: string;
  access_token: string;
  refresh_token: string;
  birth_date: string;
}

export interface RefreshRequest {
  refresh_token: string;
}

export interface RefreshResponse {
  access_token: string;
  refresh_token: string;
}

export interface Track {
  track_uuid: string;
  track_name: string;
  artist_uuid: string;
  artist_name: string;
  album_uuid: string;
  album_name: string;
  explicit: boolean;
  duration_ms: number;
}

export interface LightTrack {
  track_uuid: string;
  track_name: string;
  explicit: boolean;
  duration_ms: number;
}

export interface TrackPath {
  path: string;
  duration_ms: number;
  /** С версии с обложками: чтобы найти альбом трека без доп. запросов. */
  album_uuid: string;
}

export interface TrackDetails {
  track_uuid: string;
  track_name: string;
  artist_uuid: string;
  album_uuid: string;
  explicit: boolean;
  path: string;
  duration_ms: number;
}

export interface AddTrackRequest {
  track_name: string;
  artist_uuid: string;
  album_uuid: string;
  explicit?: boolean;
  /** Имя исходного файла. Сервер берёт из него только расширение, путь генерирует сам. */
  path?: string;
  duration_ms?: number;
}

/** Ответ загрузки файла трека и обложек (трек/альбом) — один и тот же формат. */
export interface TrackFileResponse {
  path: string;
  size: number;
}

export interface Artist {
  artist_uuid: string;
  artist_name: string;
}

export interface AddArtistRequest {
  artist_name: string;
}

export interface LightAlbum {
  album_uuid: string;
  album_name: string;
  created_at: string;
}

export interface Album {
  album_uuid: string;
  artist_uuid: string;
  album_name: string;
  created_at: string;
  /** Путь обложки в хранилище, пустая строка — обложки нет. Файл API v1 не отдаёт — только путь. */
  cover_path: string;
}

export interface AddAlbumRequest {
  artist_uuid: string;
  album_name: string;
}

export interface AlbumTrackInput {
  track_uuid: string;
  position: number;
}

export interface AddTracksToAlbumRequest {
  tracks: AlbumTrackInput[];
}

export interface Page {
  limit?: number;
  offset?: number;
}

// ----- admin: операции владельца узла (см. privy_stream/api/v1/openapi.yaml) -----

export type AdminServiceStatus = 'UP' | 'DOWN';

export interface AdminServiceHealth {
  name: string;
  status: AdminServiceStatus;
  ms: number;
  note?: string;
  /** true, если проверка дошла до БД/кэша; отсутствие поля — проверка не дошла. */
  postgres?: boolean;
  redis?: boolean;
}

export interface AdminHealth {
  checked_at: string;
  services: AdminServiceHealth[];
}

export interface AdminSession {
  /** SHA-256 refresh-токена: сам токен user_service не покидает. */
  session_id: string;
  /** Unix-секунды: последняя ротация токена. */
  created_at: number;
  /** Unix-секунды: когда refresh-токен истечёт. */
  expires_at: number;
}

export interface AdminUser {
  user_uuid: string;
  user_name: string;
  role: string;
  blocked: boolean;
  birth_date: string;
  created_at: string;
}

export interface AdminUsersPage {
  users: AdminUser[];
  total: number;
}

export interface AdminLogEntry {
  /** Unix-миллисекунды. */
  at: number;
  level: 'INFO' | 'WARN' | 'ERROR';
  service: string;
  method?: string;
  path?: string;
  code?: string;
  ms?: number;
  message?: string;
}

export interface AdminLogsPage {
  entries: AdminLogEntry[];
}

export type ModerationFilter = 'all' | 'explicit' | 'clean';

export interface AdminModerationPage {
  tracks: Track[];
  total: number;
}
