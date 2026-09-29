import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { admin } from '../api/endpoints';
import { errorLabel, refreshTokens } from '../api/http';
import { accessExpiresAt, decodeClaims } from '../api/session';
import { ErrorLine, ScreenHeader, SkeletonRows, useConfirm } from '../components/ui';
import { sha256Hex } from '../lib/hash';
import { ageFrom, fmtDate, fmtRelative, plural, shortId } from '../lib/format';
import { useAuthActions, useSession } from '../state/auth';
import { useToast } from '../state/toast';

function device() {
  const ua = navigator.userAgent;
  const browser = /Firefox\/(\d+)/.exec(ua)?.[0] ?? /Edg\/(\d+)/.exec(ua)?.[0] ?? /Chrome\/(\d+)/.exec(ua)?.[0] ?? /Version\/(\d+).*Safari/.exec(ua)?.[0] ?? 'Браузер';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser.replace('/', ' ').replace(/Version (\d+).*Safari/, 'Safari $1'), os].filter(Boolean).join(' · ');
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(t);
  }, [ms]);
  return now;
}

export function Sessions() {
  const session = useSession();
  const { logout } = useAuthActions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, node } = useConfirm();
  const now = useNow();
  const [rotations, setRotations] = useState(0);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const sessions = useQuery({
    queryKey: ['admin-sessions'],
    queryFn: () => admin.sessions(session!.userUuid),
    enabled: !!session,
  });

  // Текущая сессия в списке = SHA-256 собственного refresh-токена.
  useEffect(() => {
    const token = session?.refreshToken;
    if (!token) return;
    let alive = true;
    sha256Hex(token).then((id) => alive && setCurrentId(id));
    return () => {
      alive = false;
    };
  }, [session?.refreshToken]);

  if (!session) return null;

  const claims = decodeClaims(session.accessToken);
  const exp = accessExpiresAt(session.accessToken);
  const age = ageFrom(session.birthDate);

  const rotate = async () => {
    try {
      await refreshTokens();
      setRotations((n) => n + 1);
      // refresh-токен ротирован — список сессий устарел
      queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
      toast('Пара токенов обновлена · refresh ротирован');
    } catch (e) {
      toast(`Refresh · ${errorLabel(e)}`);
    }
  };

  const doLogout = async () => {
    if (await confirm('Завершить эту сессию?', 'Refresh-токен будет отозван на узле, вход потребуется заново.', 'Выйти')) {
      await logout().catch(() => {});
    }
  };

  const revoke = async (sessionId: string) => {
    const isCurrent = sessionId === currentId;
    if (
      !(await confirm(
        isCurrent ? 'Завершить эту сессию?' : 'Отозвать сессию?',
        isCurrent
          ? 'Это сессия этой вкладки: refresh-токен будет отозван, вход потребуется заново.'
          : `Сессия ${shortId(sessionId)} потеряет возможность обновлять токены.`,
        isCurrent ? 'Выйти' : 'Отозвать',
      ))
    ) {
      return;
    }
    try {
      await admin.revokeSession(session.userUuid, sessionId);
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
      toast(isCurrent ? 'Сессия отозвана · эта вкладка завершит вход' : 'Сессия отозвана');
      if (isCurrent) await logout().catch(() => {});
    } catch (e) {
      toast(`Отзыв · ${errorLabel(e)}`);
    }
  };

  const revokeOthers = async () => {
    if (!currentId) return;
    if (!(await confirm('Завершить все другие сессии?', `Все сессии аккаунта, кроме текущей (${shortId(currentId)}), будут отозваны.`, 'Отозвать другие'))) {
      return;
    }
    try {
      await admin.revokeOthers(session.userUuid, currentId);
      await queryClient.invalidateQueries({ queryKey: ['admin-sessions'] });
      toast('Другие сессии отозваны');
    } catch (e) {
      toast(`Отзыв · ${errorLabel(e)}`);
    }
  };

  const list = sessions.data?.sessions ?? [];

  return (
    <>
      <ScreenHeader code="05 · Доступ" title="Сессии" sub="Refresh-токены узла · RS256 · ротация при каждом обновлении. Идентификатор сессии — хэш токена, сам токен узел не показывает." />
      <div className="stack gap-30">
        <div className="list">
          <div className="wrap-row">
            <div style={{ flex: '1 1 210px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: '600 13px/1 var(--mono)' }}>{session.userName}</span>
                <span className="status-text c-ok" style={{ letterSpacing: '.12em' }}>
                  ЭТА ВКЛАДКА
                </span>
              </div>
              <span style={{ font: '400 11px/1.3 var(--sans)', color: 'var(--text-3)' }}>{device()}</span>
            </div>
            <div style={{ flex: '1 1 170px', display: 'flex', flexDirection: 'column', gap: 6, font: '400 11px/1.4 var(--mono)', color: 'var(--text-4)' }}>
              <span>
                user <span style={{ color: 'var(--text-2)' }}>{shortId(claims?.sub ?? session.userUuid)}</span> · ротаций во вкладке #{rotations}
              </span>
              <span>access {exp ? `истекает ${fmtRelative(exp, now)}` : 'без exp'} · обновится автоматически</span>
            </div>
            <div style={{ flex: '1 1 150px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ font: '500 12px/1 var(--mono)', color: 'var(--text-2)' }}>
                {age === null ? '—' : `${age} ${plural(age, ['год', 'года', 'лет'])}`} · {fmtDate(session.birthDate)}
              </span>
              <span className={`status-text ${age !== null && age < 18 ? 'c-warn' : 'c-muted'}`}>
                {age !== null && age < 18 ? 'МЕТКИ 18+ ОГРАНИЧЕНЫ' : 'ПОЛНЫЙ КАТАЛОГ'}
              </span>
            </div>
            <div style={{ flex: '0 0 auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="status-text c-ok">АКТИВНА</span>
              <button type="button" className="btn sm" onClick={rotate}>
                Обновить токен
              </button>
              <button type="button" className="btn-danger" style={{ padding: '8px 11px' }} onClick={doLogout}>
                Выйти
              </button>
            </div>
          </div>
        </div>

        <div className="section">
          <div className="section-head">
            <div className="label">Сессии аккаунта на узле</div>
            <div className="hint">{list.length ? `${list.length} активных` : ''}</div>
          </div>
          <ErrorLine error={sessions.error} onRetry={() => sessions.refetch()} />
          <div className="list">
            {sessions.isPending && <SkeletonRows count={2} cover={false} />}
            {list.map((s) => {
              const isCurrent = s.session_id === currentId;
              const expired = s.expires_at * 1000 <= now;
              return (
                <div className="wrap-row" key={s.session_id} style={isCurrent ? undefined : { opacity: 0.92 }}>
                  <div style={{ flex: '1 1 220px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ font: '600 12px/1.2 var(--mono)' }}>{shortId(s.session_id)}</span>
                    <span style={{ font: '400 11px/1.3 var(--sans)', color: 'var(--text-4)' }}>
                      последняя ротация {fmtRelative(s.created_at * 1000, now)}
                    </span>
                  </div>
                  <div style={{ flex: '1 1 180px', display: 'flex', flexDirection: 'column', gap: 6, font: '400 11px/1.4 var(--mono)', color: 'var(--text-4)' }}>
                    <span>истекает {fmtRelative(s.expires_at * 1000, now)}</span>
                    <span style={{ color: 'var(--text-5)' }}>{fmtDate(new Date(s.expires_at * 1000).toISOString())}</span>
                  </div>
                  <div style={{ flex: '0 0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                    {isCurrent ? (
                      <span className="status-text c-ok">ЭТА СЕССИЯ</span>
                    ) : expired ? (
                      <span className="status-text c-muted">ИСТЕКАЕТ</span>
                    ) : null}
                    <button type="button" className={isCurrent ? 'btn-danger' : 'btn sm'} style={{ padding: '8px 11px' }} onClick={() => revoke(s.session_id)}>
                      {isCurrent ? 'Выйти' : 'Отозвать'}
                    </button>
                  </div>
                </div>
              );
            })}
            {sessions.data && !list.length && (
              <div className="empty">Активных сессий нет: список наполняется после входа и обновлений токенов.</div>
            )}
          </div>
          {list.length > 1 && (
            <div className="row-foot">
              <span>Текущая сессия останется активной</span>
              <button type="button" className="link" onClick={revokeOthers}>
                Отозвать все другие сессии
              </button>
            </div>
          )}
        </div>
      </div>
      {node}
    </>
  );
}

const USERS_PAGE = 50;

export function Users() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm, node } = useConfirm();

  const pages = useInfiniteQuery({
    queryKey: ['admin-users'],
    queryFn: ({ pageParam }: { pageParam: number }) => admin.users({ limit: USERS_PAGE, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (last, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.users.length, 0);
      return loaded < last.total ? loaded : undefined;
    },
  });
  const rows = pages.data?.pages.flatMap((p) => p.users) ?? [];
  const total = pages.data?.pages.at(-1)?.total ?? 0;

  const block = useMutation({
    mutationFn: ({ id, blocked }: { id: string; blocked: boolean }) => admin.setUserBlocked(id, blocked),
    onSuccess: (_res, vars) => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      toast(vars.blocked ? 'Аккаунт заблокирован · сессии отозваны' : 'Блокировка снята');
    },
    onError: (e) => toast(`Блокировка · ${errorLabel(e)}`),
  });

  const toggleBlock = async (user: (typeof rows)[number]) => {
    const action = user.blocked ? 'Разблокировать' : 'Заблокировать';
    if (
      !(await confirm(
        `${action} ${user.user_name}?`,
        user.blocked
          ? 'Аккаунт снова сможет входить на узел.'
          : 'Аккаунт не сможет входить и обновлять токены, все его сессии будут отозваны немедленно.',
        action,
      ))
    ) {
      return;
    }
    block.mutate({ id: user.user_uuid, blocked: !user.blocked });
  };

  return (
    <>
      <ScreenHeader
        code="04 · Доступ"
        title="Пользователи"
        sub="Аккаунты на этом узле. Блокировка отзывает сессии немедленно и закрывает вход; владелец (owner) — это первый аккаунт узла."
      />
      <div className="stack gap-14">
        <ErrorLine error={pages.error} onRetry={() => pages.refetch()} />
        <div className="list">
          {pages.isPending && <SkeletonRows count={3} cover={false} />}
          {rows.map((u) => (
            <div className="wrap-row" key={u.user_uuid} style={u.blocked ? { opacity: 0.6 } : undefined}>
              <div style={{ flex: '1 1 200px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ font: '600 13px/1.2 var(--sans)' }}>{u.user_name}</span>
                  {u.role === 'owner' && <span className="status-text c-ok">ВЛАДЕЛЕЦ</span>}
                  {u.blocked && <span className="status-text c-err">ЗАБЛОКИРОВАН</span>}
                </div>
                <span style={{ font: '400 11px/1.3 var(--mono)', color: 'var(--text-4)' }}>{shortId(u.user_uuid)}</span>
              </div>
              <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: 6, font: '400 11px/1.4 var(--sans)', color: 'var(--text-4)' }}>
                <span>зарегистрирован {fmtDate(u.created_at)}</span>
                <span>дата рождения {fmtDate(u.birth_date)}</span>
              </div>
              <div style={{ flex: '0 0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  type="button"
                  className={u.blocked ? 'btn sm' : 'btn-danger'}
                  style={{ padding: '8px 11px' }}
                  disabled={block.isPending}
                  onClick={() => toggleBlock(u)}
                >
                  {u.blocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
              </div>
            </div>
          ))}
          {pages.data && !rows.length && <div className="empty">На узле пока нет аккаунтов.</div>}
        </div>
        {rows.length > 0 && (
          <div className="row-foot">
            <span>
              Показано {rows.length} из {total}
            </span>
            {pages.hasNextPage && (
              <button type="button" className="link" disabled={pages.isFetchingNextPage} onClick={() => pages.fetchNextPage()}>
                Показать ещё {Math.min(USERS_PAGE, total - rows.length)}
              </button>
            )}
          </div>
        )}
      </div>
      {node}
    </>
  );
}
