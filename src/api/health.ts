import { admin } from './endpoints';
import type { AdminHealth, AdminServiceHealth, AdminServiceStatus } from './types';

export type { AdminHealth, AdminServiceHealth, AdminServiceStatus };

// Состояние узла отдаёт gateway (GET /admin/health): ping postgres/redis
// в user_service, postgres в catalog_service, пробный запрос к
// streaming_service и os.Stat хранилища треков.
export async function fetchAdminHealth(): Promise<AdminHealth> {
  return admin.health();
}

export function overallStatus(list: AdminServiceHealth[] | undefined): AdminServiceStatus | null {
  if (!list?.length) return null;
  if (list.some((s) => s.status === 'DOWN')) return 'DOWN';
  return 'UP';
}
