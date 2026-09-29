// Кольцевой буфер HTTP-запросов этой админки к Gateway.
// Серверных логов в API v1 нет — это то, что видно со стороны клиента.

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';
export type LogService = 'gateway' | 'user_service' | 'catalog_service' | 'streaming_service';

export interface RequestLogEntry {
  id: number;
  at: Date;
  level: LogLevel;
  service: LogService;
  method: string;
  path: string;
  code: string;
  ms: number;
  note?: string;
}

const CAPACITY = 200;
/** Ёмкость кольцевого буфера — экран «Запросы» пишет её в подписи «Показано N из M». */
export const LOG_CAPACITY = CAPACITY;
let seq = 0;
let entries: RequestLogEntry[] = [];
const listeners = new Set<() => void>();

// Какой сервис за Gateway обработал путь — по маршрутам gateway/internal/handlers.
export function serviceForPath(path: string): LogService {
  if (path.startsWith('/catalog')) return 'catalog_service';
  if (path.startsWith('/stream')) return 'streaming_service';
  if (/^\/(login|register|refresh|logout)\b/.test(path)) return 'user_service';
  return 'gateway';
}

export function levelForStatus(status: number): LogLevel {
  if (status === 0 || status >= 500) return 'ERROR';
  if (status >= 400) return 'WARN';
  return 'INFO';
}

export function logRequest(e: Omit<RequestLogEntry, 'id' | 'at' | 'service'> & { service?: LogService }) {
  const entry: RequestLogEntry = { ...e, id: ++seq, at: new Date(), service: e.service ?? serviceForPath(e.path) };
  entries = [entry, ...entries].slice(0, CAPACITY);
  listeners.forEach((l) => l());
}

export function getRequestLog() {
  return entries;
}

export function subscribeRequestLog(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
