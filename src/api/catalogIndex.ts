import { mapPool, paginate } from '../lib/pool';
import { catalog } from './endpoints';
import type { Artist, LightTrack } from './types';

// В API v1 нет «списка всего каталога» — только поиск по подстроке
// (catalog_service: `artist_name ILIKE '%' || $1 || '%'`, пустая строка отклоняется).
// `%` не экранируется и работает как wildcard, поэтому так получаем всех артистов.
// Если бэкенд начнёт экранировать `%` или появится GET /catalog/artists — заменить здесь.
export const LIST_ALL_WILDCARD = '%';

export interface AlbumEntry {
  album_uuid: string;
  album_name: string;
  created_at: string;
  artist_uuid: string;
  artist_name: string;
  tracks: LightTrack[];
}

export interface CatalogIndex {
  artists: Artist[];
  albums: AlbumEntry[];
  trackCount: number;
  explicitCount: number;
}

export async function loadCatalogIndex(): Promise<CatalogIndex> {
  const artists = await paginate((offset, limit) => catalog.searchArtists(LIST_ALL_WILDCARD, { offset, limit }));

  const perArtist = await mapPool(artists, 6, async (artist) => {
    const albums = await paginate((offset, limit) => catalog.getArtistAlbums(artist.artist_uuid, { offset, limit }));
    return albums.map((a) => ({ ...a, artist_uuid: artist.artist_uuid, artist_name: artist.artist_name }));
  });

  const flat = perArtist.flat();
  const albums: AlbumEntry[] = await mapPool(flat, 6, async (a) => ({
    ...a,
    tracks: (await catalog.getAlbumTracks(a.album_uuid)) ?? [],
  }));

  albums.sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
  const tracks = albums.flatMap((a) => a.tracks);
  return {
    artists,
    albums,
    trackCount: tracks.length,
    explicitCount: tracks.filter((t) => t.explicit).length,
  };
}

// Тип релиза в API не хранится — выводим по числу треков (подпись для UI).
export type ReleaseType = 'Альбом' | 'EP' | 'Сингл';
export function releaseType(trackCount: number): ReleaseType {
  if (trackCount <= 1) return 'Сингл';
  if (trackCount <= 6) return 'EP';
  return 'Альбом';
}
