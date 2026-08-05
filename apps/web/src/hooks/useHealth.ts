import type { HealthResponse } from '@itlife/shared';
import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../services/apiClient';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => apiFetch<HealthResponse>('/api/v1/health'),
    retry: false,
  });
}
