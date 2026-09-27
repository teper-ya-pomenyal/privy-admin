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
