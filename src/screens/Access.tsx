import { useEffect, useState } from 'react';
import { errorLabel, refreshTokens } from '../api/http';
import { accessExpiresAt, decodeClaims } from '../api/session';
import { ScreenHeader, Unsupported, useConfirm } from '../components/ui';
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
  const { confirm, node } = useConfirm();
  const now = useNow();
  const [rotations, setRotations] = useState(0);
  if (!session) return null;

  const claims = decodeClaims(session.accessToken);
  const exp = accessExpiresAt(session.accessToken);
  const age = ageFrom(session.birthDate);

  const rotate = async () => {
    try {
      await refreshTokens();
      setRotations((n) => n + 1);
      toast('Пара токенов обновлена · refresh ротирован');
    } catch (e) {
      toast(`Refresh · ${errorLabel(e)}`);
    }
  };

  const doLogout = async () => {
    if (await confirm('Завершить эту сессию?', 'Refresh-токен будет инвалидирован через POST /logout, вход потребуется заново.', 'Выйти')) {
      await logout().catch(() => {});
    }
  };

  return (
    <>
      <ScreenHeader code="05 · Доступ" title="Сессии" sub="Refresh-токены · RS256 · ротация при каждом /refresh." />
      <div className="stack gap-30">
        <div className="list">
          <div className="wrap-row">
            <div style={{ flex: '1 1 210px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ font: '600 13px/1 var(--mono)' }}>{session.userName}</span>
                <span className="status-text c-ok" style={{ letterSpacing: '.12em' }}>
                  ЭТА СЕССИЯ
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

        <Unsupported
          title="Список сессий узла"
          text="Gateway отдаёт только /refresh и /logout для собственного токена. Увидеть семьи refresh-токенов других пользователей, события REUSE и отозвать чужие сессии без admin-эндпоинтов нельзя."
          endpoints={['GET /v1/admin/sessions?user=', 'DELETE /v1/admin/sessions/{familyId}', 'POST /v1/admin/sessions/revoke-others', 'роль OWNER в claims access-токена']}
        />
      </div>
      {node}
    </>
  );
}

export function Users() {
  return (
    <>
      <ScreenHeader code="04 · Доступ" title="Пользователи" sub="Аккаунты на этом узле. Возраст считается по дате рождения при регистрации." />
      <Unsupported
        title="Управление аккаунтами"
        text="В API v1 есть только регистрация и вход. Списка пользователей, ролей и блокировки нет — экран включится, когда Gateway получит admin-эндпоинты. Блокировка должна сразу отзывать все сессии пользователя."
        endpoints={['GET /v1/admin/users', 'PATCH /v1/admin/users/{id} · { blocked }', 'роль OWNER в claims access-токена (сейчас в JWT только sub и birth_date)']}
      />
    </>
  );
}
