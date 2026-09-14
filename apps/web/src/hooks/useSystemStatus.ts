import type { SystemStatusResponse } from '@itlife/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: () => apiFetch<SystemStatusResponse>('/api/v1/system-status', undefined, { silent: true }),
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
}
