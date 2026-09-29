// Хранилище пары токенов. Refresh ротируется при каждом /refresh (см. user_service),
// поэтому всегда сохраняем новую пару целиком.

export interface Session {
  userUuid: string;
  userName: string;
  birthDate: string;
  accessToken: string;
  refreshToken: string;
  /** Роль из claims access-токена; 'owner' — единственный, кому открыта админка. */
  role?: string;
}

export interface AccessClaims {
  sub?: string;
  exp?: number;
  iat?: number;
  birth_date?: string;
  role?: string;
  [k: string]: unknown;
}

const KEY = 'privy.admin.session';
const listeners = new Set<() => void>();

let current: Session | null = load();

function load(): Session | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function getSession() {
  return current;
}

export function setSession(next: Session | null) {
  current = next;
  if (next) localStorage.setItem(KEY, JSON.stringify(next));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export function updateTokens(accessToken: string, refreshToken: string) {
  if (!current) return;
  // Роль читаем из нового access-токена: владелец мог лишиться роли на сервере.
  const role = decodeClaims(accessToken)?.role ?? current.role;
  setSession({ ...current, accessToken, refreshToken, role });
}

export function subscribeSession(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

// Разбор payload без проверки подписи — только для UI (срок жизни, subject).
// Подпись RS256 проверяет Gateway.
export function decodeClaims(token: string): AccessClaims | null {
  try {
    const part = token.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '='));
    return JSON.parse(decodeURIComponent(escape(json))) as AccessClaims;
  } catch {
    return null;
  }
}

export function accessExpiresAt(token: string): number | null {
  const exp = decodeClaims(token)?.exp;
  return typeof exp === 'number' ? exp * 1000 : null;
}
