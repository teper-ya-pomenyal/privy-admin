import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Sessions, Users } from './screens/Access';
import { Catalog } from './screens/Catalog';
import { Login } from './screens/Login';
import { Logs } from './screens/Logs';
import { Moderation } from './screens/Moderation';
import { Overview } from './screens/Overview';
import { Releases } from './screens/Releases';
import { useSession } from './state/auth';
import { NoAccess } from './screens/NoAccess';

export function App() {
  const session = useSession();
  const qc = useQueryClient();
  const userUuid = session?.userUuid;

  useEffect(() => {
    if (!userUuid) qc.clear();
  }, [userUuid, qc]);

  if (!session) return <Login />;
  // Сервер всё равно проверяет роль (RequireOwner на записи каталога) —
  // здесь только честный экран вместо видимости рабочего инструмента.
  if (session.role !== 'owner') return <NoAccess />;

  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Overview />} />
        <Route path="releases" element={<Releases />} />
        <Route path="catalog/:id?" element={<Catalog />} />
        <Route path="users" element={<Users />} />
        <Route path="sessions" element={<Sessions />} />
        <Route path="moderation" element={<Moderation />} />
        <Route path="logs" element={<Logs />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
