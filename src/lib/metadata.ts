import { parseBlob } from 'music-metadata';

export const AUDIO_EXT = ['flac', 'wav', 'mp3', 'm4a', 'alac', 'aiff', 'aif', 'ogg', 'opus'];
export const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'webp'];

export const extOf = (name: string) => name.split('.').pop()?.toLowerCase() ?? '';
export const isAudio = (f: File) => AUDIO_EXT.includes(extOf(f.name)) || f.type.startsWith('audio/');
export const isImage = (f: File) => IMAGE_EXT.includes(extOf(f.name)) || f.type.startsWith('image/');

// Размеры картинки в пикселях; null — прочитать не удалось.
export function imageSize(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const done = (v: { w: number; h: number } | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    img.onload = () => done({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => done(null);
    img.src = url;
  });
}

export interface AudioMeta {
  title: string;
  // Название есть в тегах файла, а не выведено из имени файла.
  titleFromTags: boolean;
  artist: string;
  album: string;
  year: string;
  trackNo: number | null;
  discNo: number | null;
  durationMs: number | null;
  codec: string;
  bits: number | null;
  sampleRate: number | null;
  explicit: boolean;
  explicitSource: string | null;
}

// "03 - Факел.flac" → { no: 3, title: "Факел" }
function fromFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, '');
  const m = base.match(/^\s*(\d{1,3})\s*[-._)\s]\s*(.+)$/);
  return m ? { no: Number(m[1]), title: m[2].trim() } : { no: null, title: base.trim() };
}

function durationViaAudioElement(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (v: number | null) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

// Флаг explicit из тегов: iTunes (rtng / ITUNESADVISORY), Vorbis EXPLICIT.
function explicitFrom(native: Record<string, { id: string; value: unknown }[]>): string | null {
  for (const [format, tags] of Object.entries(native)) {
    for (const t of tags) {
      const id = t.id.toUpperCase();
      const v = String(typeof t.value === 'object' && t.value !== null && 'text' in t.value ? (t.value as { text: unknown }).text : t.value);
      if ((id === 'RTNG' || id.endsWith('ITUNESADVISORY')) && (v === '1' || v === '4')) return `${format} · ${t.id}=${v}`;
      if (id === 'EXPLICIT' && /^(1|true|yes)$/i.test(v)) return `${format} · EXPLICIT=${v}`;
    }
  }
  return null;
}

export async function probeAudio(file: File): Promise<AudioMeta> {
  const fallback = fromFileName(file.name);
  const mm = await parseBlob(file, { duration: true, skipCovers: true });
  const c = mm.common;
  const f = mm.format;
  let durationMs = f.duration ? Math.round(f.duration * 1000) : null;
  if (!durationMs) durationMs = await durationViaAudioElement(file);
  const explicitSource = explicitFrom(mm.native as Record<string, { id: string; value: unknown }[]>);
  return {
    title: c.title?.trim() || fallback.title,
    titleFromTags: !!c.title?.trim(),
    artist: (c.albumartist || c.artist || '').trim(),
    album: (c.album ?? '').trim(),
    year: c.year ? String(c.year) : '',
    trackNo: c.track?.no ?? fallback.no,
    discNo: c.disk?.no ?? null,
    durationMs,
    codec: (f.codec || f.container || extOf(file.name)).toUpperCase(),
    bits: f.bitsPerSample ?? null,
    sampleRate: f.sampleRate ?? null,
    explicit: !!explicitSource,
    explicitSource,
  };
}

export function audioQuality(m: AudioMeta) {
  if (m.bits && m.sampleRate) return `${m.bits}/${Math.round(m.sampleRate / 100) / 10}`;
  if (m.sampleRate) return `${Math.round(m.sampleRate / 100) / 10} kHz`;
  return '';
}

// Рекурсивный обход перетащенных папок (DataTransferItem.webkitGetAsEntry).
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items)
    .map((i) => i.webkitGetAsEntry?.())
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.length) return Array.from(dt.files);

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      out.push(await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej)));
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries отдаёт порциями — читаем до пустого ответа.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  for (const e of entries) await walk(e);
  return out;
}
