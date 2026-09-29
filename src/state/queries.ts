import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { loadCatalogIndex } from '../api/catalogIndex';
import { fetchAdminHealth } from '../api/health';
import { admin } from '../api/endpoints';
import { getRequestLog, subscribeRequestLog } from '../api/requestLog';

export const CATALOG_KEY = ['catalog-index'] as const;

export function useCatalogIndex() {
  return useQuery({ queryKey: CATALOG_KEY, queryFn: loadCatalogIndex, staleTime: 60_000 });
}

/** Health узла от gateway: ping postgres/redis/stream/хранилища. */
export function useHealth() {
  return useQuery({ queryKey: ['health'], queryFn: fetchAdminHealth, refetchInterval: 10_000, staleTime: 5_000, retry: 1 });
}

/** Журнал узла: опрос раз в 5 с, пока экран «Запросы» показывает источник «Узел». */
export function useServerLogs(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-logs'],
    queryFn: () => admin.logs(200),
    refetchInterval: 5_000,
    staleTime: 2_000,
    enabled,
    retry: 1,
  });
}

export function useRequestLog() {
  return useSyncExternalStore(subscribeRequestLog, getRequestLog);
}
