import type { HealthResponse } from '@itlife/shared';
import { useQuery } from '@tanstack/react-query';
import { publicApiFetch } from '../services/publicApiClient';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => publicApiFetch<HealthResponse>('/api/v1/health'),
    retry: false,
  });
}
