// SHA-256 как hex — тот же алгоритм, каким user_service строит session_id
// из refresh-токена (см. redis_session_store.go). Нужен, чтобы пометить
// текущую сессию в списке, не отправляя токен на сервер.
export async function sha256Hex(value: string): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    // нет web crypto (незащищённый контекст) — текущую сессию не пометить
    return null;
  }
}
