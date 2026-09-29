import { levelForStatus, logRequest } from './requestLog';
import { accessExpiresAt, getSession, setSession, updateTokens } from './session';
import type { RefreshResponse } from './types';

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? '';

// Gateway отвечает на ошибки через http.Error — text/plain с сообщением.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
  get label() {
    return this.status ? `${this.status} · ${this.message}` : this.message;
  }
}

export function errorLabel(err: unknown) {
  if (err instanceof ApiError) return err.label;
  if (err instanceof Error) return err.message;
  return String(err);
}

type Query = Record<string, string | number | undefined>;

export interface RequestOptions {
  body?: unknown;
  query?: Query;
  auth?: boolean;
  signal?: AbortSignal;
  headers?: Record<string, string>;
  /** Не писать в журнал запросов (служебные проверки здоровья). */
  silent?: boolean;
}

function buildUrl(path: string, query?: Query) {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

// ---------- refresh (single-flight) ----------

let refreshing: Promise<void> | null = null;
const REFRESH_SKEW_MS = 20_000;

export function refreshTokens(): Promise<void> {
  if (refreshing) return refreshing;
  const session = getSession();
  if (!session) return Promise.reject(new ApiError(401, 'нет сессии'));

  refreshing = (async () => {
    const started = performance.now();
    let res: Response;
    try {
      res = await fetch(buildUrl('/refresh'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: session.refreshToken }),
      });
    } catch {
      logRequest({ level: 'ERROR', method: 'POST', path: '/refresh', code: 'NETWORK', ms: ms(started) });
      throw new ApiError(0, 'Gateway недоступен');
    }
    logRequest({ level: levelForStatus(res.status), method: 'POST', path: '/refresh', code: String(res.status), ms: ms(started) });
    if (!res.ok) {
      const msg = (await res.text()).trim();
      // Токен истёк, отозван или предъявлен повторно — сессия потеряна.
      // 403: аккаунт заблокирован — обновление невозможно, держать сессию бессмысленно.
      if (res.status === 401 || res.status === 400 || res.status === 403) setSession(null);
      throw new ApiError(res.status, msg || 'refresh отклонён');
    }
    const pair = (await res.json()) as RefreshResponse;
    updateTokens(pair.access_token, pair.refresh_token);
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

async function authHeader(): Promise<Record<string, string>> {
  let session = getSession();
  if (!session) throw new ApiError(401, 'нет сессии');
  const exp = accessExpiresAt(session.accessToken);
  if (exp !== null && exp - Date.now() < REFRESH_SKEW_MS) {
    await refreshTokens();
    session = getSession();
    if (!session) throw new ApiError(401, 'сессия истекла');
  }
  return { Authorization: `Bearer ${session.accessToken}` };
}

const ms = (started: number) => Math.round(performance.now() - started);

// ---------- core ----------

export async function rawRequest(method: string, path: string, opts: RequestOptions = {}, retried = false): Promise<Response> {
  const { body, query, auth = true, signal, headers = {}, silent = false } = opts;
  const h: Record<string, string> = { ...headers };
  if (auth) Object.assign(h, await authHeader());
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    h['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const started = performance.now();
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), { method, headers: h, body: payload, signal });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    if (!silent) logRequest({ level: 'ERROR', method, path, code: 'NETWORK', ms: ms(started) });
    throw new ApiError(0, 'Gateway недоступен');
  }
  if (!silent)
    logRequest({
      level: levelForStatus(res.status),
      method,
      path,
      code: String(res.status),
      ms: ms(started),
    });

  if (res.status === 401 && auth && !retried) {
    await refreshTokens();
    return rawRequest(method, path, opts, true);
  }
  if (res.status === 401 && auth) setSession(null);
  return res;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(method, path, opts);
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).trim();
    throw new ApiError(res.status, text || res.statusText || 'ошибка запроса');
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  const type = res.headers.get('Content-Type') ?? '';
  return (type.includes('json') ? JSON.parse(text) : text) as T;
}

// ---------- upload с прогрессом (fetch его не отдаёт) ----------

export function uploadForm<T>(
  path: string,
  form: FormData,
  onProgress: (fraction: number) => void,
  signal?: AbortSignal,
  retried = false,
): Promise<T> {
  return authHeader().then(
    (headers) =>
      new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const started = performance.now();
        xhr.open('POST', buildUrl(path));
        Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(e.loaded / e.total);
        };
        xhr.onload = () => {
          logRequest({
            level: levelForStatus(xhr.status),
            method: 'POST',
            path,
            code: String(xhr.status),
            ms: ms(started),
          });
          if (xhr.status === 401 && !retried) {
            refreshTokens()
              .then(() => uploadForm<T>(path, form, onProgress, signal, true))
              .then(resolve, reject);
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(new ApiError(xhr.status, xhr.responseText.trim() || xhr.statusText));
            return;
          }
          try {
            resolve((xhr.responseText ? JSON.parse(xhr.responseText) : undefined) as T);
          } catch {
            resolve(undefined as T);
          }
        };
        xhr.onerror = () => {
          logRequest({ level: 'ERROR', method: 'POST', path, code: 'NETWORK', ms: ms(started) });
          reject(new ApiError(0, 'Gateway недоступен'));
        };
        xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', () => xhr.abort());
        xhr.send(form);
      }),
  );
}
